import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCachedConversion,
  setCachedConversion,
  stageVersions,
} from "../../../lib/cache";
import {
  convertRecipeToArtifact,
  convertToArtifact,
  type PipelineResult,
} from "../../../lib/pipeline";
import { CanonicalRecipeSchema } from "../../../lib/schema/canonical";
import type { CookAlongArtifact } from "../../../lib/schema/artifact";
import { fetchAndExtract, normalizeUrl } from "../../../lib/intake/url";
import { extractFromText } from "../../../lib/intake/text";
import { checkRateLimit, MAX_RECIPE_JSON_CHARS, reserveDailyUnit } from "../../../lib/limits";
import { logEvent } from "../../../lib/log";
import { isContributorModel, requestEffortOverrides, resolveProvider } from "../../../lib/model";
import { applyArtifactAllergenFloor } from "../../../lib/allergens";
import { reviewNoteTexts } from "../../../lib/review-notes";
import type { CanonicalizeInput } from "../../../lib/stages/canonicalize";
import type { ConvertEvent } from "../../../lib/convert-events";
import {
  clientIp as sharedClientIp,
  eventStream,
  fail,
  limited,
  logFailure,
  readJsonBody,
  refuseCrossSite,
  runLive,
  TOO_LARGE_MESSAGE,
  wantsEvents,
} from "../helpers";

// A fresh conversion takes 2-4 minutes with the cook-along format rules
// (scratch timings 158-217 s at low canonicalize effort); the pipeline stops
// itself at CONVERT_DEADLINE_MS, under this limit.
export const maxDuration = 420;
/** Pipeline deadline for conversions, counted from the request start. */
export const CONVERT_DEADLINE_MS = 400_000;

const ROUTE = "convert";

const BodySchema = z.strictObject({
  url: z.string().optional(),
  text: z.string().optional(),
  recipe: z.unknown().optional(),
});

/** Kept as an export: other routes import it from here. */
export function clientIp(request: Request): string {
  return sharedClientIp(request);
}

function logConvert(fields: {
  kind: "url" | "text" | "photo";
  cached: boolean;
  durationMs: number;
  tokensTotal: number;
  checksPassed: boolean;
  /** NDJSON progress events (true) or one JSON answer. */
  stream: boolean;
  /** Live conversions: reasoning_effort and wall-clock ms per model stage. */
  efforts?: PipelineResult["efforts"];
  timings?: Record<string, number>;
  overview?: "ok" | "failed" | "pending";
}): void {
  logEvent("convert", fields);
}

/** Efforts, per-stage timings and the overview outcome of a live conversion, for tuning. */
function liveLogFields(result: PipelineResult): {
  efforts: PipelineResult["efforts"];
  timings: Record<string, number>;
  overview?: "ok" | "failed" | "pending";
} {
  return {
    efforts: result.efforts,
    timings: {
      ...result.timings,
      ...(result.overview ? { overviewMs: result.overview.ms } : {}),
    },
    ...(result.overview ? { overview: result.overview.status } : {}),
  };
}

type Send = (event: ConvertEvent) => void;

/**
 * Stream a live conversion: progress events while it runs, then `done`
 * (built by `work` after its side effects), or one `error` event with the
 * status and message the JSON answer would have had.
 */
function streamLive(work: (send: Send) => Promise<ConvertEvent>): Response {
  return eventStream(async (send) => {
    try {
      send(await work(send));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversion failed.";
      const status = errorStatus(message);
      logFailure(ROUTE, status, { error: message }, error);
      send({ type: "error", status, error: message });
    }
  });
}

function errorStatus(message: string): number {
  // A blocked review first: its reasons are the model's own words ("held
  // too long", "credentials"), which the patterns below would misread.
  // compile() always starts the message with "compile blocked:".
  if (/^compile blocked:/i.test(message)) return 422;
  // Then "took too long to convert" (deadline, model timeout): it also
  // contains "too long", which below means pasted text over the limit.
  if (/took too long to convert/i.test(message)) return 503;
  if (/exactly one of|invalid url|invalid recipe|only https|only public https|private-network|credentials|default port/i.test(message)) {
    return 400;
  }
  if (/no text provided|too long/i.test(message)) return 400;
  if (/single-recipe pages only|compile blocked/i.test(message)) return 422;
  if (/missing model api key|contributor-tier/i.test(message)) return 500;
  if (/validation|valid json|empty content|cut off at the length limit/i.test(message)) return 502;
  if (/timed out|fetch failed|byte cap|content type|resolve host|redirect|status \d+/i.test(message)) {
    return 502;
  }
  return 500;
}

/** Floor allergens on cached artifacts (cached before the floor existed). */
function floorCached(artifact: CookAlongArtifact): CookAlongArtifact {
  try {
    return Array.isArray(artifact?.recipe?.ingredients)
      ? applyArtifactAllergenFloor(artifact)
      : artifact;
  } catch {
    return artifact;
  }
}

/**
 * Checks before any live work: the per-IP rate limit, then the production
 * contributor-model guard. Returns a response to send, or null to proceed.
 */
async function liveGate(request: Request): Promise<NextResponse | null> {
  const rate = await checkRateLimit(clientIp(request));
  if (!rate.allowed) return limited(ROUTE, "rate_limited");
  const config = resolveProvider("meta");
  if (process.env.NODE_ENV === "production" && isContributorModel(config.model)) {
    return fail(ROUTE, 500, { error: "Service misconfigured." });
  }
  return null;
}

/**
 * Convert a recipe URL, pasted text, or a confirmed canonical recipe (photo
 * flow) into a Cook Along artifact. Order: validate, serve cache hits (free:
 * no rate limit, no daily cap), per-IP rate limit, fetch the page, then
 * reserve one unit of the daily cap right before the model runs. The unit is
 * given back if the request fails before any model tokens are spent.
 *
 * With `Accept: application/x-ndjson` the live work streams progress events
 * (facts, overview, recipe, procedure, then done or error; see
 * convert-events.ts) from a 200 response that starts once the checks above
 * pass. Failures before that keep their JSON status; a cache hit streams one
 * `done` event. Without the header the answer is the JSON below, unchanged.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const crossSite = refuseCrossSite(ROUTE, request);
  if (crossSite) return crossSite;
  // NDJSON progress events (convert-events.ts) when the client asks; every
  // check before live work keeps its JSON answer either way.
  const stream = wantsEvents(request);
  // reasoning_effort overrides from x-textsous-efforts, on preview deployments only.
  const efforts = requestEffortOverrides(request.headers);
  const body = await readJsonBody(request);
  if (!body.ok) return fail(ROUTE, 413, { error: TOO_LARGE_MESSAGE });
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) {
    return fail(ROUTE, 400, { error: "Body must be JSON with {url} or {text}." });
  }
  const url = typeof parsed.data.url === "string" ? parsed.data.url.trim() : "";
  const text = typeof parsed.data.text === "string" ? parsed.data.text : "";
  const hasRecipe = parsed.data.recipe !== undefined;
  const provided =
    (url.length > 0 ? 1 : 0) + (text.trim().length > 0 ? 1 : 0) + (hasRecipe ? 1 : 0);
  if (provided !== 1) {
    return fail(ROUTE, 400, { error: "Provide exactly one of {url}, {text} or {recipe}." });
  }

  try {
    if (url.length > 0) {
      let normalized: string;
      try {
        normalized = normalizeUrl(url);
      } catch {
        return fail(ROUTE, 400, { error: "Invalid URL." });
      }
      if (!normalized.startsWith("https://")) {
        return fail(ROUTE, 400, { error: "Only https URLs are accepted." });
      }
      const cached = await getCachedConversion(normalized);
      if (cached) {
        logConvert({
          kind: "url",
          cached: true,
          durationMs: Date.now() - started,
          tokensTotal: 0,
          checksPassed: cached.checksPassed,
          stream,
        });
        if (stream) {
          const artifact = floorCached(cached.artifact);
          const warnings = reviewNoteTexts(cached.artifact);
          return eventStream(async (send) => {
            send({ type: "done", artifact, cached: true, warnings });
          });
        }
        return NextResponse.json({
          artifact: floorCached(cached.artifact),
          schedule: cached.schedule,
          cached: true,
          // Advisory review notes travel with the artifact (D1).
          warnings: reviewNoteTexts(cached.artifact),
        });
      }
      const gate = await liveGate(request);
      if (gate) return gate;
      const extracted = await fetchAndExtract(normalized);
      const reservation = await reserveDailyUnit();
      if (!reservation.allowed) return limited(ROUTE, "daily_cap");
      const input: CanonicalizeInput = {
        source: {
          kind: "url",
          url: extracted.canonicalUrl,
          site: extracted.site,
          author: extracted.author,
        },
        title: extracted.title,
        ingredientLines: extracted.ingredientLines,
        instructionLines: extracted.instructionLines,
        servingsRaw: extracted.servingsRaw,
        rawText: extracted.rawText,
        hasJsonLd: extracted.hasJsonLd,
      };
      const convert = (onEvent?: Send) =>
        runLive(
          reservation,
          () =>
            convertToArtifact(input, {
              provider: "meta",
              efforts,
              ...(onEvent ? { onEvent, jsonLd: extracted.jsonLd ?? null } : {}),
            }),
          started,
          CONVERT_DEADLINE_MS,
        );
      // Cache write and log, the same in both modes.
      const settle = async (result: PipelineResult): Promise<void> => {
        const checksPassed =
          result.canonicalize.checks.every((c) => c.passed) &&
          result.procedure.checks.every((c) => c.passed) &&
          result.review.checks.every((c) => c.passed);
        await setCachedConversion(normalized, {
          artifact: result.artifact,
          schedule: result.schedule,
          cachedAt: new Date().toISOString(),
          versions: stageVersions(),
          checksPassed,
        }).catch((error: unknown) => {
          logEvent("cache_write_failed", {
            route: ROUTE,
            errorClass: error instanceof Error ? error.name : typeof error,
          });
        });
        logConvert({
          kind: "url",
          cached: false,
          durationMs: Date.now() - started,
          tokensTotal: result.usageTotal.totalTokens,
          checksPassed,
          stream,
          ...liveLogFields(result),
        });
      };
      if (stream) {
        return streamLive(async (send) => {
          const result = await convert(send);
          await settle(result);
          return {
            type: "done",
            artifact: result.artifact,
            cached: false,
            warnings: [...extracted.warnings, ...result.warnings],
          };
        });
      }
      const result = await convert();
      await settle(result);
      return NextResponse.json({
        artifact: result.artifact,
        schedule: result.schedule,
        cached: false,
        warnings: [...extracted.warnings, ...result.warnings],
        usage: {
          canonicalize: result.canonicalize.usage,
          procedure: result.procedure.usage,
          review: result.review.usage,
          total: result.usageTotal,
        },
        timings: result.timings,
        formatWarnings: result.formatWarnings,
      });
    }

    if (hasRecipe) {
      const valid = CanonicalRecipeSchema.safeParse(parsed.data.recipe);
      if (!valid.success) {
        return fail(ROUTE, 400, { error: "Invalid recipe." });
      }
      // Same window as pasted text, before any limit or daily unit.
      if (JSON.stringify(valid.data).length > MAX_RECIPE_JSON_CHARS) {
        return fail(ROUTE, 400, { error: "Recipe is too long (60,000 characters max)." });
      }
      const gate = await liveGate(request);
      if (gate) return gate;
      const reservation = await reserveDailyUnit();
      if (!reservation.allowed) return limited(ROUTE, "daily_cap");
      const convert = (onEvent?: Send) =>
        runLive(
          reservation,
          () =>
            convertRecipeToArtifact(valid.data, {
              provider: "meta",
              efforts,
              ...(onEvent ? { onEvent } : {}),
            }),
          started,
          CONVERT_DEADLINE_MS,
        );
      const settle = (result: PipelineResult): void => {
        const checksPassed =
          result.procedure.checks.every((c) => c.passed) &&
          result.review.checks.every((c) => c.passed);
        logConvert({
          kind: "photo",
          cached: false,
          durationMs: Date.now() - started,
          tokensTotal: result.usageTotal.totalTokens,
          checksPassed,
          stream,
          ...liveLogFields(result),
        });
      };
      if (stream) {
        return streamLive(async (send) => {
          const result = await convert(send);
          settle(result);
          return { type: "done", artifact: result.artifact, cached: false, warnings: result.warnings };
        });
      }
      const result = await convert();
      settle(result);
      return NextResponse.json({
        artifact: result.artifact,
        schedule: result.schedule,
        cached: false,
        warnings: result.warnings,
        usage: {
          canonicalize: result.canonicalize.usage,
          procedure: result.procedure.usage,
          review: result.review.usage,
          total: result.usageTotal,
        },
        timings: result.timings,
        formatWarnings: result.formatWarnings,
      });
    }

    // Pasted text: refused before any limit is touched when too long.
    const extracted = extractFromText(text);
    const gate = await liveGate(request);
    if (gate) return gate;
    const reservation = await reserveDailyUnit();
    if (!reservation.allowed) return limited(ROUTE, "daily_cap");
    const input: CanonicalizeInput = {
      source: { kind: "text" },
      rawText: extracted.rawText,
      ingredientLines: [],
      instructionLines: [],
      hasJsonLd: false,
    };
    const convert = (onEvent?: Send) =>
      runLive(
        reservation,
        () =>
          convertToArtifact(input, {
            provider: "meta",
            efforts,
            ...(onEvent ? { onEvent } : {}),
          }),
        started,
        CONVERT_DEADLINE_MS,
      );
    const settle = (result: PipelineResult): void => {
      const checksPassed =
        result.canonicalize.checks.every((c) => c.passed) &&
        result.procedure.checks.every((c) => c.passed) &&
        result.review.checks.every((c) => c.passed);
      logConvert({
        kind: "text",
        cached: false,
        durationMs: Date.now() - started,
        tokensTotal: result.usageTotal.totalTokens,
        checksPassed,
        stream,
        ...liveLogFields(result),
      });
    };
    if (stream) {
      return streamLive(async (send) => {
        const result = await convert(send);
        settle(result);
        return { type: "done", artifact: result.artifact, cached: false, warnings: result.warnings };
      });
    }
    const result = await convert();
    settle(result);
    return NextResponse.json({
      artifact: result.artifact,
      schedule: result.schedule,
      cached: false,
      warnings: result.warnings,
      usage: {
        canonicalize: result.canonicalize.usage,
        procedure: result.procedure.usage,
        review: result.review.usage,
        total: result.usageTotal,
      },
      timings: result.timings,
      formatWarnings: result.formatWarnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed.";
    return fail(ROUTE, errorStatus(message), { error: message }, error);
  }
}
