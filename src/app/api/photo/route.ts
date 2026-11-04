import { NextResponse } from "next/server";
import {
  MAX_PHOTO_BODY_BYTES,
  MAX_PHOTOS,
  photoToCanonical,
  PhotoError,
  validatePhoto,
} from "../../../lib/intake/photo";
import { checkRateLimit, reserveDailyUnit } from "../../../lib/limits";
import { logEvent } from "../../../lib/log";
import { clientIp, fail, limited, refuseCrossSite, runLive } from "../helpers";

// Transcribe + canonicalize can take two minutes; the pipeline stops itself
// at about 280 s.
export const maxDuration = 300;

const ROUTE = "photo";

const TOO_MANY_PHOTOS = "Send up to 3 photos of one recipe.";
const NO_PHOTO = 'Send 1 to 3 photos of one recipe as multipart field "photo".';
const TOO_LARGE_TOGETHER = "These photos are too large together. Try fewer or smaller photos.";

function errorStatus(message: string): number {
  if (/took too long to convert/i.test(message)) return 503;
  if (/failed validation|valid JSON|empty content|cut off at the length limit/i.test(message)) {
    return 502;
  }
  if (/missing model api key/i.test(message)) return 500;
  return 500;
}

function logPhoto(event: { durationMs: number; tokensTotal: number; photos: number }): void {
  logEvent("photo", event);
}

/**
 * Transcribe 1 to 3 photos of one recipe (the multipart field "photo",
 * repeated in page order) in one vision call, then canonicalize the
 * transcription. The image bytes live in memory only: they are never written
 * to disk, cache or logs. One rate-limit hit and one daily unit per request,
 * whatever the photo count. The status is always needs_review (confirm
 * screen).
 */
export async function POST(req: Request) {
  const started = Date.now();
  const crossSite = refuseCrossSite(ROUTE, req);
  if (crossSite) return crossSite;
  try {
    const length = req.headers.get("content-length");
    if (length !== null && Number(length) > MAX_PHOTO_BODY_BYTES) {
      return fail(ROUTE, 413, { error: TOO_LARGE_TOGETHER });
    }
    const form = await req.formData().catch(() => null);
    const entries = form?.getAll("photo") ?? [];
    if (entries.length > MAX_PHOTOS) return fail(ROUTE, 400, { error: TOO_MANY_PHOTOS });
    const files = entries.filter((entry): entry is File => entry instanceof File);
    if (files.length === 0 || files.length !== entries.length) {
      return fail(ROUTE, 400, { error: NO_PHOTO });
    }
    // The cap holds without a content-length too (a chunked upload).
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_PHOTO_BODY_BYTES) {
      return fail(ROUTE, 413, { error: TOO_LARGE_TOGETHER });
    }
    const photos: Uint8Array[] = [];
    for (const [i, file] of files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        validatePhoto(bytes, files.length > 1 ? i + 1 : undefined);
      } catch (error) {
        if (error instanceof PhotoError) {
          return fail(
            ROUTE,
            error.code === "too-large" ? 413 : 400,
            { error: error.message },
            error,
          );
        }
        throw error;
      }
      photos.push(bytes);
    }
    const rate = await checkRateLimit(`photo:${clientIp(req)}`);
    if (!rate.allowed) return limited(ROUTE, "rate_limited");
    const reservation = await reserveDailyUnit();
    if (!reservation.allowed) return limited(ROUTE, "daily_cap");
    const result = await runLive(reservation, () => photoToCanonical(photos));
    logPhoto({
      durationMs: Date.now() - started,
      tokensTotal: result.usage.transcribe.totalTokens + result.usage.canonicalize.totalTokens,
      photos: photos.length,
    });
    return NextResponse.json({
      recipe: result.recipe,
      transcription: result.transcription,
      status: result.status,
      usage: result.usage,
      warnings: result.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo intake failed.";
    return fail(ROUTE, errorStatus(message), { error: message }, error);
  }
}
