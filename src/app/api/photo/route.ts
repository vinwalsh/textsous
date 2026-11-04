import { NextResponse } from "next/server";
import { photoToCanonical, PhotoError, validatePhoto } from "../../../lib/intake/photo";
import { checkRateLimit, reserveDailyUnit } from "../../../lib/limits";
import { logEvent } from "../../../lib/log";
import { clientIp, fail, limited, runLive } from "../helpers";

// Transcribe + canonicalize can take two minutes; the pipeline stops itself
// at about 280 s.
export const maxDuration = 300;

const ROUTE = "photo";

/** Multipart headroom above the 5 MB photo limit for an early 413. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

function errorStatus(message: string): number {
  if (/took too long to convert/i.test(message)) return 503;
  if (/failed validation|valid JSON|empty content|cut off at the length limit/i.test(message)) {
    return 502;
  }
  if (/missing model api key/i.test(message)) return 500;
  return 500;
}

function logPhoto(event: { durationMs: number; tokensTotal: number }): void {
  logEvent("photo", event);
}

/**
 * Transcribe a recipe photo, then canonicalize the transcription. The image
 * bytes live in memory only: they are never written to disk, cache or logs.
 * The result status is always needs_review (confirm screen in M4.2).
 */
export async function POST(req: Request) {
  const started = Date.now();
  try {
    const length = req.headers.get("content-length");
    if (length !== null && Number(length) > MAX_BODY_BYTES) {
      return fail(ROUTE, 413, { error: "Photo is larger than the 5 MB limit." });
    }
    const form = await req.formData().catch(() => null);
    const file = form?.get("photo");
    if (!(file instanceof File)) {
      return fail(ROUTE, 400, { error: 'Send one photo as multipart field "photo".' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      validatePhoto(bytes);
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
    const rate = await checkRateLimit(`photo:${clientIp(req)}`);
    if (!rate.allowed) return limited(ROUTE, "rate_limited");
    const reservation = await reserveDailyUnit();
    if (!reservation.allowed) return limited(ROUTE, "daily_cap");
    const result = await runLive(reservation, () => photoToCanonical(bytes));
    logPhoto({
      durationMs: Date.now() - started,
      tokensTotal: result.usage.transcribe.totalTokens + result.usage.canonicalize.totalTokens,
    });
    return NextResponse.json({
      recipe: result.recipe,
      transcription: result.transcription,
      status: result.status,
      usage: result.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo intake failed.";
    return fail(ROUTE, errorStatus(message), { error: message }, error);
  }
}
