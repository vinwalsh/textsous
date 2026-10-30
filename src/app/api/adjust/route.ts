import { NextResponse } from "next/server";
import { z } from "zod";
import { CookAlongArtifactSchema } from "../../../lib/schema/artifact";
import { adjustArtifact } from "../../../lib/pipeline";
import { checkDailyCap, checkRateLimit } from "../../../lib/limits";
import { logEvent } from "../../../lib/log";
import { clientIp } from "../convert/route";

const BodySchema = z.strictObject({
  artifact: z.unknown(),
  servings: z.number().optional(),
  dietary: z.string().optional(),
  cuisine: z.string().optional(),
  voice: z.string().optional(),
});

function errorStatus(message: string): number {
  if (
    /Invalid artifact|unknown dietary|unsupported voice|cuisine target must not be empty|out of range/i.test(
      message,
    )
  ) {
    return 400;
  }
  if (/failed validation|valid JSON|empty completion|refuses:/i.test(message)) return 502;
  if (/missing model api key/i.test(message)) return 500;
  return 500;
}

function logAdjust(event: { durationMs: number; tokensTotal: number }): void {
  logEvent("adjust", event);
}

/**
 * Apply servings, dietary, cuisine and voice adjustments (in that order) to a
 * compiled artifact. No cache: every call runs the model stages it needs.
 */
export async function POST(req: Request) {
  const started = Date.now();
  try {
    const limited = await checkRateLimit(`adjust:${clientIp(req)}`);
    if (!limited.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again in a few minutes." },
        { status: 429 },
      );
    }
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Request body must be a JSON object with an artifact field." },
        { status: 400 },
      );
    }
    const valid = CookAlongArtifactSchema.safeParse(parsed.data.artifact);
    if (!valid.success) {
      return NextResponse.json({ error: "Invalid artifact." }, { status: 400 });
    }
    const capped = await checkDailyCap();
    if (!capped.allowed) {
      return NextResponse.json(
        { error: "Daily conversion cap reached. Try again tomorrow." },
        { status: 429 },
      );
    }
    const result = await adjustArtifact(
      valid.data,
      {
        servings: parsed.data.servings,
        dietary: parsed.data.dietary,
        cuisine: parsed.data.cuisine,
        voice: parsed.data.voice,
      },
      { provider: "meta" },
    );
    logAdjust({
      durationMs: Date.now() - started,
      tokensTotal: result.usage.total.totalTokens,
    });
    return NextResponse.json({
      artifact: result.artifact,
      scaleFlags: result.scaleFlags,
      usage: result.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Adjustment failed: ${message}` },
      { status: errorStatus(message) },
    );
  }
}
