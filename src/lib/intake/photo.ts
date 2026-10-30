import { z } from "zod";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { canonicalize, type CanonicalizeResult } from "../stages/canonicalize";
import type { CanonicalRecipe } from "../schema/canonical";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_SCHEMA_NAME = "photo_transcription";

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
 * Accept PNG, JPEG or WebP up to 5 MB. Pure and memory-only: the bytes are
 * never written to disk, cache or logs.
 */
export function validatePhoto(bytes: Uint8Array): ValidatedPhoto {
  const type = detectImageType(bytes);
  if (!type) {
    throw new PhotoError("unsupported-type", "Unsupported image type: send PNG, JPEG or WebP.");
  }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new PhotoError("too-large", "Photo is larger than the 5 MB limit.");
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

function transcribeSystemPrompt(orientation: number): string {
  const orientationNote =
    orientation === 1
      ? ""
      : ` The photo's EXIF orientation flag is ${orientation} (not standard upright): read the text accordingly even if it appears rotated or mirrored.`;
  return (
    "You are transcribing a cookbook or recipe photo for TextSous. Transcribe EVERY visible " +
    "recipe word verbatim: ingredient lines with quantities and units exactly as printed, " +
    "instruction steps in order, and any servings, yield or timing lines. Never invent, correct, " +
    "reorder or summarize recipe words. Skip non-recipe text such as page headers, footers and " +
    `advertisements.${orientationNote} Read any visible book title, author and page number into ` +
    "book, author and page (null when not visible). Reply with only JSON matching the schema, no prose."
  );
}

/**
 * One vision call: the photo goes in as an image_url data URL in a user
 * message, and the model replies with the verbatim transcription plus any
 * visible book credit.
 */
export async function transcribePhoto(
  imageDataUrl: string,
  orientation: number,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<{ transcription: PhotoTranscription; usage: TokenUsage }> {
  const result = await callStructured(
    PhotoTranscriptionSchema,
    [
      { role: "system", content: transcribeSystemPrompt(orientation) },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this recipe photo." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    { provider: opts.provider, client: opts.client, schemaName: PHOTO_SCHEMA_NAME },
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
  };
}

export interface PhotoResult {
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  status: "needs_review";
  usage: { transcribe: TokenUsage; canonicalize: TokenUsage };
  canonicalizeResult: CanonicalizeResult;
}

/**
 * Full photo intake: validate, transcribe the photo, then canonicalize the
 * transcription with a photo source (book, author, page). The status is always
 * needs_review: a transcription must be confirmed before cooking.
 */
export async function photoToCanonical(
  bytes: Uint8Array,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<PhotoResult> {
  const photo = validatePhoto(bytes);
  const transcribed = await transcribePhoto(photoDataUrl(photo), photo.orientation, opts);
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
  };
}
