import { NextResponse } from "next/server";
import { photoToCanonical, PhotoError, validatePhoto } from "../../../lib/intake/photo";
import { checkDailyCap, checkRateLimit } from "../../../lib/limits";
import { logEvent } from "../../../lib/log";
import { clientIp } from "../convert/route";

/** Multipart headroom above the 5 MB photo limit for an early 413. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

function errorStatus(message: string): number {
  if (/failed validation|valid JSON|empty content/i.test(message)) return 502;
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
    const rate = await checkRateLimit(`photo:${clientIp(req)}`);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 },
      );
    }
    const length = req.headers.get("content-length");
    if (length !== null && Number(length) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Photo is larger than the 5 MB limit." }, { status: 413 });
    }
    const form = await req.formData().catch(() => null);
    const file = form?.get("photo");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Send one photo as multipart field "photo".' },
        { status: 400 },
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      validatePhoto(bytes);
    } catch (error) {
      if (error instanceof PhotoError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.code === "too-large" ? 413 : 400 },
        );
      }
      throw error;
    }
    const cap = await checkDailyCap();
    if (!cap.allowed) {
      return NextResponse.json({ error: "Daily conversion cap reached." }, { status: 429 });
    }
    const result = await photoToCanonical(bytes);
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Photo intake failed." },
      { status: errorStatus(error instanceof Error ? error.message : "") },
    );
  }
}
