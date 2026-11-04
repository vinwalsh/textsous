/**
 * Pure helpers for the /embed page (client-safe: no node or Next imports).
 * The host-page script (public/embed.js) is plain JS with its own copies of
 * the few helpers it needs; tests/embed-script.test.ts covers those.
 */

import { servingsInRange } from "./scaling/servings";
import { DIETARY_TARGETS, MAX_CUISINE_CHARS } from "./schema/variant";

/** Message the embed page posts to the host page to close the overlay. */
export const EMBED_CLOSE_MESSAGE = "textsous:close";
/** The embed page asks the host page for a pre-converted artifact (data-src). */
export const EMBED_NEED_ARTIFACT_MESSAGE = "textsous:need-artifact";
/** The host page answers with the artifact JSON it fetched. */
export const EMBED_ARTIFACT_MESSAGE = "textsous:artifact";

/** Lowercased hostname without a leading "www.", or null for a bad URL. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return stripWww(parsed.hostname);
  } catch {
    return null;
  }
}

export function stripWww(host: string): string {
  const lower = host.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * Same site for the same-page rule: equal hosts ignoring "www.", or one host
 * is a subdomain of the other (recipes.example.com and example.com). This
 * approximates "same registrable domain" without a public-suffix list, and
 * stays strict for sibling subdomains (alice.github.io vs bob.github.io).
 */
export function hostsMatch(a: string, b: string): boolean {
  const x = stripWww(a);
  const y = stripWww(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** Origin of the page that embeds us: ancestorOrigins[0], else the referrer's origin. */
export function embeddingOrigin(input: {
  ancestorOrigins?: ArrayLike<string> | null;
  referrer?: string | null;
}): string | null {
  const first = input.ancestorOrigins && input.ancestorOrigins.length > 0
    ? input.ancestorOrigins[0]
    : null;
  if (first && first !== "null") return first;
  if (input.referrer) {
    try {
      const origin = new URL(input.referrer).origin;
      return origin === "null" ? null : origin;
    } catch {
      return null;
    }
  }
  return null;
}

export type SamePageResult =
  | { ok: true; checked: boolean }
  | { ok: false; reason: "mismatch"; recipeHost: string; pageHost: string }
  | { ok: false; reason: "invalid-url" };

/**
 * The /embed page converts only a recipe on the site that embeds it. When the
 * embedding page is unknown (no ancestorOrigins, no referrer) it proceeds.
 */
export function samePageCheck(recipeUrl: string, pageOrigin: string | null): SamePageResult {
  const recipeHost = hostOf(recipeUrl);
  if (!recipeHost) return { ok: false, reason: "invalid-url" };
  if (!pageOrigin) return { ok: true, checked: false };
  const pageHost = hostOf(pageOrigin);
  if (!pageHost) return { ok: true, checked: false };
  if (hostsMatch(recipeHost, pageHost)) return { ok: true, checked: true };
  return { ok: false, reason: "mismatch", recipeHost, pageHost };
}

/** True when a message comes from the expected window and origin. */
export function isTrustedMessage(
  event: { origin: string; source?: unknown },
  expected: { origin: string | null; source?: unknown },
): boolean {
  if (expected.source !== undefined && event.source !== expected.source) return false;
  if (expected.origin === null) return true;
  return event.origin === expected.origin;
}

/** Message data shaped like `{ type: <type> }`. */
export function isMessageOfType(data: unknown, type: string): data is { type: string } & Record<string, unknown> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === type
  );
}

/** Same origin as `base`? Bad URLs are never same-origin. */
export function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export type DietaryChoice = (typeof DIETARY_TARGETS)[number];

/**
 * An adjustment chosen in embed.js's "Adjust with SOUS" menu, applied as soon
 * as the cook along is ready. Any mix of the three is allowed.
 */
export interface EmbedAdjust {
  servings?: number;
  dietary?: DietaryChoice;
  cuisine?: string;
}

/** What the /embed page was asked to show, and the adjustment to apply to it. */
export type EmbedRequest =
  | { kind: "url"; url: string; adjust?: EmbedAdjust }
  | { kind: "src"; src: string; adjust?: EmbedAdjust }
  | { kind: "none" };

type QueryValue = string | string[] | undefined;

/** The /embed query: `url` or `src`, plus the optional `servings`, `dietary` and `cuisine`. */
export interface EmbedParams {
  url?: QueryValue;
  src?: QueryValue;
  servings?: QueryValue;
  dietary?: QueryValue;
  cuisine?: QueryValue;
}

function firstValue(v: QueryValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Control characters out, runs of spaces as one space, trimmed. */
function tidyText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The adjustment in an /embed query. Each value counts only when valid:
 * servings in the adjust range (MIN_SERVINGS-MAX_SERVINGS), dietary one of
 * DIETARY_TARGETS, cuisine 1-MAX_CUISINE_CHARS characters once trimmed.
 * Anything else is ignored, never an error. Null when nothing is left.
 */
export function parseEmbedAdjust(params: Pick<EmbedParams, "servings" | "dietary" | "cuisine">): EmbedAdjust | null {
  const adjust: EmbedAdjust = {};
  const servings = firstValue(params.servings);
  if (/^\d{1,3}(\.\d{1,2})?$/.test(servings) && servingsInRange(Number(servings))) {
    adjust.servings = Number(servings);
  }
  const dietary = firstValue(params.dietary).toLowerCase();
  const diet = DIETARY_TARGETS.find((target) => target === dietary);
  if (diet) adjust.dietary = diet;
  const cuisine = tidyText(firstValue(params.cuisine));
  if (cuisine.length >= 1 && cuisine.length <= MAX_CUISINE_CHARS) adjust.cuisine = cuisine;
  return Object.keys(adjust).length > 0 ? adjust : null;
}

export function parseEmbedRequest(params: EmbedParams): EmbedRequest {
  const adjust = parseEmbedAdjust(params);
  const extra = adjust ? { adjust } : {};
  const src = firstValue(params.src);
  if (src) return { kind: "src", src, ...extra };
  const url = firstValue(params.url);
  if (url) return { kind: "url", url, ...extra };
  return { kind: "none" };
}

function servingsText(servings: number): string {
  return `${servings} ${servings === 1 ? "serving" : "servings"}`;
}

/**
 * The calm line the overlay shows while it works on an adjustment:
 * "Scaling to 18 servings…", "Making it vegan…", "Making it more Italian…",
 * or several joined ("Scaling to 18 servings and making it vegan…"). Pure.
 */
export function adjustLine(adjust: EmbedAdjust): string {
  const parts: string[] = [];
  if (adjust.servings !== undefined) parts.push(`scaling to ${servingsText(adjust.servings)}`);
  if (adjust.dietary) parts.push(`making it ${adjust.dietary}`);
  if (adjust.cuisine) parts.push(`making it more ${adjust.cuisine}`);
  if (parts.length === 0) return "";
  const text =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}\u2026`;
}

/**
 * The /embed URL embed.js opens. Mirrors buildFrameUrl in public/embed.js;
 * the docs and the demo page use this one.
 */
export function buildEmbedUrl(
  origin: string,
  opts: { url?: string; src?: string; host?: string; adjust?: EmbedAdjust },
): string {
  const params = new URLSearchParams();
  if (opts.src) params.set("src", opts.src);
  else if (opts.url) params.set("url", opts.url);
  if (opts.adjust?.servings) params.set("servings", String(opts.adjust.servings));
  if (opts.adjust?.dietary) params.set("dietary", opts.adjust.dietary);
  if (opts.adjust?.cuisine) params.set("cuisine", opts.adjust.cuisine);
  if (opts.host) params.set("utm_source", opts.host);
  params.set("utm_medium", "embed");
  return `${origin.replace(/\/$/, "")}/embed?${params.toString()}`;
}
