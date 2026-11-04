import { z } from "zod";
import {
  callStructured,
  type ChatContentPart,
  type ProviderName,
  type ReasoningEffort,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { canonicalize, type CanonicalizeResult } from "../stages/canonicalize";
import { assertTimeFor, STAGE_MIN_MS } from "../model/budget";
import type { CanonicalRecipe } from "../schema/canonical";

/** Photos in one request: consecutive pages of one recipe. */
export const MAX_PHOTOS = 3;
/**
 * The whole /api/photo request body. The hosting platform refuses function
 * request bodies over 4.5 MB, so the route answers 413 above this first.
 */
export const MAX_PHOTO_BODY_BYTES = Math.floor(4.4 * 1024 * 1024);
/** One photo: always under the body cap, with room for the multipart framing. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const PHOTO_SCHEMA_NAME = "photo_transcription";

/**
 * reasoning_effort for the transcription call. Reading printed words off a
 * page needs little reasoning, and the default (high) made the photo wait
 * long before canonicalize could start.
 */
export const TRANSCRIBE_REASONING_EFFORT: ReasoningEffort = "low";

export type PhotoImageType = "png" | "jpeg" | "webp";

export class PhotoError extends Error {
  code: "too-large" | "unsupported-type";
  constructor(code: "too-large" | "unsupported-type", message: string) {
    super(message);
    this.name = "PhotoError";
    this.code = code;
  }
}

/** Identify PNG, JPEG or WebP by magic bytes. Returns null for anything else. */
export function detectImageType(bytes: Uint8Array): PhotoImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function parseExifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (at: number): number | null => {
    if (at < 0 || at + 2 > tiff.length) return null;
    return little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1];
  };
  const u32 = (at: number): number | null => {
    if (at < 0 || at + 4 > tiff.length) return null;
    return little
      ? tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24) >>> 0
      : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0;
  };
  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  if (ifd0 === null) return null;
  const count = u16(ifd0);
  if (count === null) return null;
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) !== 0x0112) continue;
    if (u16(entry + 2) !== 3) return null;
    const value = u16(entry + 8);
    if (value === null || value < 1 || value > 8) return null;
    return value;
  }
  return null;
}

/**
 * Read the EXIF orientation flag (1-8) from JPEG bytes. Pure, bounds-checked,
 * and fails open to 1 (upright) on any malformed metadata: a bad EXIF block
 * never rejects the photo.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return 1;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return 1;
    if (
      marker === 0xe1 &&
      length >= 8 &&
      bytes[offset + 2] === 0x45 &&
      bytes[offset + 3] === 0x78 &&
      bytes[offset + 4] === 0x69 &&
      bytes[offset + 5] === 0x66 &&
      bytes[offset + 6] === 0x00 &&
      bytes[offset + 7] === 0x00
    ) {
      const orientation = parseExifOrientation(bytes.subarray(offset + 8, offset + length));
      if (orientation !== null) return orientation;
    }
    offset += length;
  }
  return 1;
}

export interface ValidatedPhoto {
  type: PhotoImageType;
  bytes: Uint8Array;
  orientation: number;
}

/**
 * Accept PNG, JPEG or WebP up to 4 MB. Pure and memory-only: the bytes are
 * never written to disk, cache or logs. `page` (1-based) names the photo in
 * the error when a request carries several.
 */
export function validatePhoto(bytes: Uint8Array, page?: number): ValidatedPhoto {
  const type = detectImageType(bytes);
  if (!type) {
    throw new PhotoError(
      "unsupported-type",
      page === undefined
        ? "Unsupported image type: send PNG, JPEG or WebP."
        : `Photo ${page} has an unsupported image type: send PNG, JPEG or WebP.`,
    );
  }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new PhotoError(
      "too-large",
      `${page === undefined ? "Photo" : `Photo ${page}`} is larger than the 4 MB limit.`,
    );
  }
  return { type, bytes, orientation: type === "jpeg" ? readJpegOrientation(bytes) : 1 };
}

const MIME_TYPES: Record<PhotoImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Encode validated bytes as an image_url data URL for a user message. */
export function photoDataUrl(photo: ValidatedPhoto): string {
  return `data:${MIME_TYPES[photo.type]};base64,${Buffer.from(photo.bytes).toString("base64")}`;
}

const PhotoTranscriptionSchema = z.object({
  text: z.string().min(1),
  book: z.string().nullable(),
  author: z.string().nullable(),
  page: z.number().int().positive().nullable(),
});

export type PhotoTranscription = z.infer<typeof PhotoTranscriptionSchema>;

/** What the model returns: the transcription plus whether it left a recipe out. */
const PhotoTranscriptionReplySchema = PhotoTranscriptionSchema.extend({
  otherRecipeSkipped: z.boolean(),
});

/** One photo for the transcription call, in page order. */
export interface PhotoPage {
  /** image_url data URL (photoDataUrl). */
  dataUrl: string;
  /** EXIF orientation flag, 1 when upright or unknown. */
  orientation: number;
}

function orientationNotes(orientations: readonly number[]): string {
  if (orientations.length === 1) {
    const [orientation] = orientations;
    return orientation === 1
      ? ""
      : ` The photo's EXIF orientation flag is ${orientation} (not standard upright): read the text accordingly even if it appears rotated or mirrored.`;
  }
  return orientations
    .map((orientation, i) =>
      orientation === 1
        ? ""
        : ` Photo ${i + 1}'s EXIF orientation flag is ${orientation} (not standard upright): read its text accordingly even if it appears rotated or mirrored.`,
    )
    .join("");
}

function transcribeSystemPrompt(orientations: readonly number[]): string {
  const pages =
    orientations.length > 1
      ? "The photos are consecutive pages of ONE recipe, in order: transcribe them as one " +
        "continuous text, page 1 first, without page markers. "
      : "";
  return (
    "You are transcribing a cookbook or recipe photo for TextSous. " +
    pages +
    "Transcribe EVERY visible recipe word verbatim: ingredient lines with quantities and units " +
    "exactly as printed, instruction steps in order, and any servings, yield or timing lines. " +
    "Never invent, correct, reorder or summarize recipe words. Skip non-recipe text such as page " +
    "headers, footers and advertisements. Transcribe ONE recipe: the first recipe that starts on " +
    "the first photo (when none starts there, the recipe the first photo shows), with its " +
    "continuation on any later photo. Parts of the same dish, such as a sauce, dough, filling or " +
    "topping, belong to it. Never merge two recipes: leave out the end of an earlier recipe and " +
    "any other recipe, and set otherRecipeSkipped to true when you left one out (false " +
    `otherwise).${orientationNotes(orientations)} Read any visible book title, author and the ` +
    "page number where the recipe starts into book, author and page (null when not visible). " +
    "Reply with only JSON matching the schema, no prose."
  );
}

function transcribeUserText(count: number): string {
  return count === 1
    ? "Transcribe this recipe photo."
    : `These ${count} photos are consecutive pages of ONE recipe, in order (photo 1 first). ` +
        "Transcribe them as that one recipe.";
}

/** Readable warning for a transcription that left another recipe out. */
export function otherRecipeWarning(count: number): string {
  return count === 1
    ? "The photo shows more than one recipe, so only the first one was read. Convert the others one at a time."
    : "The photos show more than one recipe, so only the one that starts on the first photo was read. Convert the others one at a time.";
}

/**
 * One vision call for every photo: one user message with one text part,
 * then each photo as an image_url data URL in page order. The model replies
 * with the verbatim transcription of one recipe plus any visible book
 * credit. Runs at low reasoning effort (TRANSCRIBE_REASONING_EFFORT).
 */
export async function transcribePhoto(
  pages: readonly PhotoPage[],
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<{ transcription: PhotoTranscription; usage: TokenUsage; warnings: string[] }> {
  if (pages.length < 1 || pages.length > MAX_PHOTOS) {
    throw new Error(`Send 1 to ${MAX_PHOTOS} photos of one recipe.`);
  }
  const content: ChatContentPart[] = [
    { type: "text", text: transcribeUserText(pages.length) },
    ...pages.map((page): ChatContentPart => ({ type: "image_url", image_url: { url: page.dataUrl } })),
  ];
  const result = await callStructured(
    PhotoTranscriptionReplySchema,
    [
      { role: "system", content: transcribeSystemPrompt(pages.map((p) => p.orientation)) },
      { role: "user", content },
    ],
    {
      provider: opts.provider,
      client: opts.client,
      schemaName: PHOTO_SCHEMA_NAME,
      reasoningEffort: TRANSCRIBE_REASONING_EFFORT,
    },
  );
  const t = result.data;
  return {
    transcription: {
      text: t.text,
      book: t.book?.trim() ? t.book.trim() : null,
      author: t.author?.trim() ? t.author.trim() : null,
      page: t.page,
    },
    usage: result.usage,
    warnings: t.otherRecipeSkipped ? [otherRecipeWarning(pages.length)] : [],
  };
}

export interface PhotoResult {
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  status: "needs_review";
  usage: { transcribe: TokenUsage; canonicalize: TokenUsage };
  canonicalizeResult: CanonicalizeResult;
  /** Readable notes for the confirm screen (another recipe left out). */
  warnings: string[];
}

/**
 * Full photo intake: validate 1 to 3 photos (pages of one recipe, in order),
 * transcribe them in one call, then canonicalize the transcription with a
 * photo source (book, author, page). The status is always needs_review: a
 * transcription must be confirmed before cooking.
 */
export async function photoToCanonical(
  input: Uint8Array | readonly Uint8Array[],
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<PhotoResult> {
  const list: readonly Uint8Array[] = input instanceof Uint8Array ? [input] : input;
  if (list.length < 1 || list.length > MAX_PHOTOS) {
    throw new Error(`Send 1 to ${MAX_PHOTOS} photos of one recipe.`);
  }
  const photos = list.map((bytes, i) => validatePhoto(bytes, list.length > 1 ? i + 1 : undefined));
  assertTimeFor("transcribe", STAGE_MIN_MS.transcribe);
  const transcribed = await transcribePhoto(
    photos.map((photo) => ({ dataUrl: photoDataUrl(photo), orientation: photo.orientation })),
    opts,
  );
  assertTimeFor("canonicalize", STAGE_MIN_MS.canonicalize);
  const canonical = await canonicalize(
    {
      source: {
        kind: "photo",
        book: transcribed.transcription.book ?? undefined,
        author: transcribed.transcription.author ?? undefined,
        page: transcribed.transcription.page ?? undefined,
      },
      rawText: transcribed.transcription.text,
      ingredientLines: [],
      instructionLines: [],
      hasJsonLd: false,
    },
    { provider: opts.provider, client: opts.client },
  );
  return {
    recipe: canonical.recipe,
    transcription: transcribed.transcription,
    status: "needs_review",
    usage: { transcribe: transcribed.usage, canonicalize: canonical.usage },
    canonicalizeResult: canonical,
    warnings: transcribed.warnings,
  };
}
