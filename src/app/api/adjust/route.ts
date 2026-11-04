import { NextResponse } from "next/server";
import { z } from "zod";
import { CookAlongArtifactSchema } from "../../../lib/schema/artifact";
import { adjustArtifact } from "../../../lib/pipeline";
import { checkRateLimit, MAX_ADJUST_ARTIFACT_CHARS, reserveDailyUnit } from "../../../lib/limits";
import { MAX_CUISINE_CHARS } from "../../../lib/schema/variant";
import { logEvent } from "../../../lib/log";
import { requestEffortOverrides } from "../../../lib/model";
import { reviewNoteTexts } from "../../../lib/review-notes";
import {
  clientIp,
  fail,
  limited,
  readJsonBody,
  refuseCrossSite,
  runLive,
  TOO_LARGE_MESSAGE,
} from "../helpers";

// Variants make up to four model calls; the pipeline stops itself at ~280 s.
export const maxDuration = 300;

const ROUTE = "adjust";

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
  if (/took too long to convert/i.test(message)) return 503;
  if (/failed validation|valid JSON|empty completion|empty content|cut off at the length limit|refuses:/i.test(message)) {
    return 502;
  }
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
  const crossSite = refuseCrossSite(ROUTE, req);
  if (crossSite) return crossSite;
  try {
    const body = await readJsonBody(req);
    if (!body.ok) return fail(ROUTE, 413, { error: TOO_LARGE_MESSAGE });
    const parsed = BodySchema.safeParse(body.value);
    if (!parsed.success) {
      return fail(ROUTE, 400, {
        error: "Request body must be a JSON object with an artifact field.",
      });
    }
    const { servings, dietary, cuisine, voice } = parsed.data;
    if (
      servings === undefined &&
      !dietary?.trim() &&
      !cuisine?.trim() &&
      !voice?.trim()
    ) {
      return fail(ROUTE, 400, {
        error: "Choose at least one adjustment: servings, dietary, cuisine or voice.",
      });
    }
    const valid = CookAlongArtifactSchema.safeParse(parsed.data.artifact);
    if (!valid.success) {
      return fail(ROUTE, 400, { error: "Invalid artifact." });
    }
    // Size checks before any limit or daily unit: one unit, one real recipe.
    if (JSON.stringify(valid.data).length > MAX_ADJUST_ARTIFACT_CHARS) {
      return fail(ROUTE, 400, { error: "This cook along is too large to adjust here (64 KB max)." });
    }
    if (cuisine !== undefined && cuisine.trim().length > MAX_CUISINE_CHARS) {
      return fail(ROUTE, 400, {
        error: `Cuisine style is too long (${MAX_CUISINE_CHARS} characters max). Name a cuisine, like Italian.`,
      });
    }
    const rate = await checkRateLimit(`adjust:${clientIp(req)}`);
    if (!rate.allowed) return limited(ROUTE, "rate_limited");
    const reservation = await reserveDailyUnit();
    if (!reservation.allowed) return limited(ROUTE, "daily_cap");
    const result = await runLive(reservation, () =>
      adjustArtifact(
        valid.data,
        {
          servings: parsed.data.servings,
          dietary: parsed.data.dietary,
          cuisine: parsed.data.cuisine,
          voice: parsed.data.voice,
        },
        // reasoning_effort overrides from x-textsous-efforts, on preview deployments only.
        { provider: "meta", efforts: requestEffortOverrides(req.headers) },
      ),
    );
    logAdjust({
      durationMs: Date.now() - started,
      tokensTotal: result.usage.total.totalTokens,
    });
    return NextResponse.json({
      artifact: result.artifact,
      scaleFlags: result.scaleFlags,
      // Code fixes from this adjustment, then the conversion's advisory
      // review notes, which the artifact carries through every adjustment.
      warnings: [...result.warnings, ...reviewNoteTexts(result.artifact)],
      usage: result.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return fail(
      ROUTE,
      errorStatus(message),
      { error: `Adjustment failed: ${message}` },
      error,
    );
  }
}
