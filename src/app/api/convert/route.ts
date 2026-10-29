import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCachedConversion,
  setCachedConversion,
  stageVersions,
} from "../../../lib/cache";
import { convertToArtifact } from "../../../lib/pipeline";
import { fetchAndExtract, normalizeUrl } from "../../../lib/intake/url";
import { extractFromText } from "../../../lib/intake/text";
import { checkDailyCap, checkRateLimit } from "../../../lib/limits";
import { isContributorModel, resolveProvider } from "../../../lib/model";
import type { CanonicalizeInput } from "../../../lib/stages/canonicalize";

const BodySchema = z.strictObject({
  url: z.string().optional(),
  text: z.string().optional(),
});

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function logConvert(fields: {
  kind: "url" | "text";
  cached: boolean;
  durationMs: number;
  tokensTotal: number;
  checksPassed: boolean;
}): void {
  console.log(JSON.stringify({ event: "convert", ...fields }));
}

function errorStatus(message: string): number {
  if (/exactly one of|invalid url|only https|only public https|private-network|credentials/i.test(message)) {
    return 400;
  }
  if (/no text provided|too long/i.test(message)) return 400;
  if (/single-recipe pages only|compile blocked/i.test(message)) return 422;
  if (/missing model api key|contributor-tier/i.test(message)) return 500;
  if (/validation|valid json|empty content/i.test(message)) return 502;
  if (/timed out|fetch failed|byte cap|content type|resolve host|redirect|status \d+/i.test(message)) {
    return 502;
  }
  return 500;
}

export async function POST(request: Request) {
  const started = Date.now();
  const raw = (await request.json().catch(() => null)) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be JSON with {url} or {text}." }, { status: 400 });
  }
  const url = typeof parsed.data.url === "string" ? parsed.data.url.trim() : "";
  const text = typeof parsed.data.text === "string" ? parsed.data.text : "";
  if (url.length > 0 === text.trim().length > 0) {
    return NextResponse.json({ error: "Provide exactly one of {url} or {text}." }, { status: 400 });
  }

  const rate = await checkRateLimit(clientIp(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 },
    );
  }

  const config = resolveProvider("meta");
  if (process.env.NODE_ENV === "production" && isContributorModel(config.model)) {
    return NextResponse.json({ error: "Service misconfigured." }, { status: 500 });
  }

  try {
    if (url.length > 0) {
      let normalized: string;
      try {
        normalized = normalizeUrl(url);
      } catch {
        return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
      }
      if (!normalized.startsWith("https://")) {
        return NextResponse.json({ error: "Only https URLs are accepted." }, { status: 400 });
      }
      const cached = await getCachedConversion(normalized);
      if (cached) {
        logConvert({
          kind: "url",
          cached: true,
          durationMs: Date.now() - started,
          tokensTotal: 0,
          checksPassed: cached.checksPassed,
        });
        return NextResponse.json({
          artifact: cached.artifact,
          schedule: cached.schedule,
          cached: true,
        });
      }
      const cap = await checkDailyCap();
      if (!cap.allowed) {
        return NextResponse.json({ error: "Daily conversion cap reached." }, { status: 429 });
      }
      const extracted = await fetchAndExtract(normalized);
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
      const result = await convertToArtifact(input, { provider: "meta" });
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
      });
      logConvert({
        kind: "url",
        cached: false,
        durationMs: Date.now() - started,
        tokensTotal: result.usageTotal.totalTokens,
        checksPassed,
      });
      return NextResponse.json({
        artifact: result.artifact,
        schedule: result.schedule,
        cached: false,
        usage: {
          canonicalize: result.canonicalize.usage,
          procedure: result.procedure.usage,
          review: result.review.usage,
          total: result.usageTotal,
        },
      });
    }

    const cap = await checkDailyCap();
    if (!cap.allowed) {
      return NextResponse.json({ error: "Daily conversion cap reached." }, { status: 429 });
    }
    const extracted = extractFromText(text);
    const result = await convertToArtifact(
      {
        source: { kind: "text" },
        rawText: extracted.rawText,
        ingredientLines: [],
        instructionLines: [],
        hasJsonLd: false,
      },
      { provider: "meta" },
    );
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
    });
    return NextResponse.json({
      artifact: result.artifact,
      schedule: result.schedule,
      cached: false,
      usage: {
        canonicalize: result.canonicalize.usage,
        procedure: result.procedure.usage,
        review: result.review.usage,
        total: result.usageTotal,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed.";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
