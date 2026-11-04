/**
 * Pure helpers for the /embed page (client-safe: no node or Next imports).
 * The host-page script (public/embed.js) is plain JS with its own copies of
 * the few helpers it needs; tests/embed-script.test.ts covers those.
 */

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

/** What the /embed page was asked to show. */
export type EmbedRequest =
  | { kind: "url"; url: string }
  | { kind: "src"; src: string }
  | { kind: "none" };

export function parseEmbedRequest(params: { url?: string | string[]; src?: string | string[] }): EmbedRequest {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const src = pick(params.src);
  if (src) return { kind: "src", src };
  const url = pick(params.url);
  if (url) return { kind: "url", url };
  return { kind: "none" };
}

/**
 * The /embed URL embed.js opens. Mirrors buildFrameUrl in public/embed.js;
 * the docs and the demo page use this one.
 */
export function buildEmbedUrl(
  origin: string,
  opts: { url?: string; src?: string; host?: string },
): string {
  const params = new URLSearchParams();
  if (opts.src) params.set("src", opts.src);
  else if (opts.url) params.set("url", opts.url);
  if (opts.host) params.set("utm_source", opts.host);
  params.set("utm_medium", "embed");
  return `${origin.replace(/\/$/, "")}/embed?${params.toString()}`;
}
