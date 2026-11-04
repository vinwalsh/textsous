import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
// Slim build: full cheerio pulls in the undici package, whose module load
// breaks global fetch to the model API in some shells. We only use load().
import * as cheerio from "cheerio/slim";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
/** Page text kept for the no-JSON-LD fallback (the canonicalize window). */
export const MAX_RAW_TEXT_CHARS = 60_000;

export interface UrlExtraction {
  sourceUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  site?: string;
  author?: string;
  title?: string;
  hasJsonLd: boolean;
  ingredientLines: string[];
  instructionLines: string[];
  servingsRaw?: string;
  rawText: string;
  /** Readable notes, e.g. page text cut to the first 60,000 characters. */
  warnings: string[];
}

// --- SSRF guards: public https only, no private IPs ---

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function ipv4IsPrivate(n: number): boolean {
  const inCidr = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base) ?? 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inCidr("10.0.0.0", 8) ||
    inCidr("172.16.0.0", 12) ||
    inCidr("192.168.0.0", 16) ||
    inCidr("127.0.0.0", 8) ||
    inCidr("169.254.0.0", 16) ||
    inCidr("0.0.0.0", 8) ||
    inCidr("100.64.0.0", 10) || // carrier-grade NAT
    inCidr("198.18.0.0", 15) || // benchmarking
    inCidr("192.0.2.0", 24) ||
    inCidr("198.51.100.0", 24) ||
    inCidr("203.0.113.0", 24) ||
    inCidr("224.0.0.0", 4) ||
    inCidr("240.0.0.0", 4)
  );
}

/** Expand an IPv6 literal to 8 groups (embedded dotted IPv4 allowed). */
function expandIpv6(literal: string): number[] | null {
  let h = literal.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  const dotted = h.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = ipv4ToInt(dotted[1]);
    if (n === null) return null;
    h = `${h.slice(0, -dotted[1].length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

function ipv6IsPrivate(literal: string): boolean {
  const g = expandIpv6(literal);
  if (!g) return true;
  const zeroUpTo = (n: number): boolean => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return true; // ::
  if (zeroUpTo(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96): judge the IPv4.
  if (zeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    const n = ((g[6] << 16) | g[7]) >>> 0;
    return ipv4IsPrivate(n);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return true; // 64:ff9b::/96 NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard
  return false;
}

function literalIsPrivate(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = ipv4ToInt(address);
    return n === null || ipv4IsPrivate(n);
  }
  if (family === 6) return ipv6IsPrivate(address);
  return true;
}

function hostnameIsPrivate(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Only public https URLs can be fetched.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed.");
  }
  if (url.port !== "") {
    throw new Error("Only the default https port is allowed.");
  }
  // Bracketed IPv6 literals are refused outright (WHATWG URL keeps the
  // brackets, so isIP() never sees them).
  if (url.hostname.startsWith("[")) {
    throw new Error("Refusing to fetch a private-network address (IPv6 literal).");
  }
  if (isIP(url.hostname)) {
    if (literalIsPrivate(url.hostname)) {
      throw new Error("Refusing to fetch a private-network address.");
    }
  } else {
    if (hostnameIsPrivate(url.hostname)) {
      throw new Error("Refusing to fetch a private-network host.");
    }
    let addresses;
    try {
      addresses = await lookup(url.hostname, { all: true });
    } catch {
      throw new Error(`Could not resolve host: ${url.hostname}`);
    }
    for (const a of addresses) {
      if (literalIsPrivate(a.address)) {
        throw new Error("Refusing to fetch a host that resolves to a private-network address.");
      }
    }
  }
  return url;
}

async function readCapped(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  // Abort the read itself when the hop timer fires (some bodies ignore the
  // fetch signal once headers have arrived).
  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(timedOut());
    signal.addEventListener("abort", () => reject(timedOut()), { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), aborted]);
      } catch (error) {
        if (signal.aborted) throw timedOut();
        throw new Error(`Fetch failed: ${(error as Error).message}`);
      }
      // Checked before done: cancel() on abort ends the stream "cleanly".
      if (signal.aborted) throw timedOut();
      const { done, value } = result;
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`Page exceeds the ${MAX_BYTES} byte cap.`);
        }
        chunks.push(value);
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function timedOut(): Error {
  return new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms.`);
}

async function fetchHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = (await assertPublicHttpsUrl(startUrl)).toString();
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    // One timer per hop that keeps running until the body is fully read, so
    // a server that sends headers and then stalls cannot hold the request.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": "TextSousOpen/0.1 (+https://open.textsous.com)",
            accept: "text/html,application/xhtml+xml",
          },
        });
      } catch (error) {
        if ((error as Error).name === "AbortError" || controller.signal.aborted) throw timedOut();
        throw new Error(`Fetch failed: ${(error as Error).message}`);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (i === MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
        }
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without a location header.");
        await response.body?.cancel().catch(() => {});
        current = (await assertPublicHttpsUrl(new URL(location, current).toString())).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new Error(`Unsupported content type: ${contentType || "unknown"}.`);
      }
      const html = await readCapped(response, controller.signal);
      return { html, finalUrl: current };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Unreachable.");
}

// --- JSON-LD extraction ---

type JsonLdNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecipeNode(node: unknown): node is JsonLdNode {
  if (typeof node !== "object" || node === null) return false;
  const types = asArray((node as JsonLdNode)["@type"] as string | string[] | undefined);
  return types.some((t) => typeof t === "string" && t.toLowerCase() === "recipe");
}

function collectJsonLdRecipes($: cheerio.CheerioAPI): JsonLdNode[] {
  const found: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const nodes: unknown[] = [];
    for (const root of asArray(data)) {
      nodes.push(root);
      if (typeof root === "object" && root !== null && "@graph" in root) {
        nodes.push(...asArray((root as JsonLdNode)["@graph"] as unknown | unknown[]));
      }
    }
    for (const node of nodes) {
      if (isRecipeNode(node)) found.push(node);
    }
  });
  return found;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/\s+/g, " ");
}

/** Flatten string | HowToStep | HowToSection (incl. nesting) to ordered lines. */
function flattenInstructions(input: unknown): string[] {
  const lines: string[] = [];
  const visit = (node: unknown, section?: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      const text = stripTags(node).trim();
      if (text) lines.push(section ? `[${section}] ${text}` : text);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, section);
      return;
    }
    if (typeof node === "object") {
      const obj = node as JsonLdNode;
      const types = asArray(obj["@type"] as string | string[] | undefined).map((t) =>
        typeof t === "string" ? t.toLowerCase() : "",
      );
      if (types.includes("howtosection")) {
        const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
        visit(obj.itemListElement, name || section);
        return;
      }
      if (types.includes("howtostep")) {
        const text =
          typeof obj.text === "string" ? obj.text : typeof obj.name === "string" ? obj.name : "";
        const cleaned = stripTags(text).trim();
        if (cleaned) lines.push(section ? `[${section}] ${cleaned}` : cleaned);
        if (obj.itemListElement) visit(obj.itemListElement, section);
        return;
      }
      if (typeof obj.text === "string") {
        const cleaned = stripTags(obj.text).trim();
        if (cleaned) lines.push(section ? `[${section}] ${cleaned}` : cleaned);
        return;
      }
      if (typeof obj.name === "string" && !obj.itemListElement) {
        const cleaned = stripTags(obj.name).trim();
        if (cleaned) lines.push(section ? `[${section}] ${cleaned}` : cleaned);
        return;
      }
      if (obj.itemListElement) {
        visit(obj.itemListElement, section);
      }
    }
  };
  visit(input);
  return lines;
}

function normalizeStringArray(value: unknown): string[] {
  return asArray(value as string | string[] | undefined)
    .filter((v): v is string => typeof v === "string")
    .map((v) => stripTags(v).trim())
    .filter((v) => v.length > 0);
}

function normalizeYield(value: unknown): string | undefined {
  const first = asArray(value as string | number | Array<string | number> | undefined)[0];
  if (typeof first === "number" && Number.isFinite(first)) return String(first);
  if (typeof first === "string" && first.trim()) return first.trim();
  return undefined;
}

function authorName(value: unknown): string | undefined {
  const first = asArray(value as string | JsonLdNode | Array<string | JsonLdNode> | undefined)[0];
  if (typeof first === "string" && first.trim()) return first.trim();
  if (typeof first === "object" && first !== null) {
    const name = (first as JsonLdNode).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}

function reduceToReadableText($: cheerio.CheerioAPI): { text: string; warnings: string[] } {
  $("script, style, noscript, template").remove();
  const article = $("article").first();
  const main = $("main").first();
  const root = article.length > 0 ? article : main.length > 0 ? main : $("body");
  root.find("nav, header, footer, aside").remove();
  const text = root.text().replace(/\s+/g, " ").trim();
  if (text.length <= MAX_RAW_TEXT_CHARS) return { text, warnings: [] };
  return {
    text: text.slice(0, MAX_RAW_TEXT_CHARS),
    warnings: [
      `The page text was ${text.length.toLocaleString("en-US")} characters; ` +
        `only the first ${MAX_RAW_TEXT_CHARS.toLocaleString("en-US")} were kept.`,
    ],
  };
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The URL credited as the recipe's source ("View original"). A page's
 * rel=canonical is trusted only when it is https on the same host as the
 * fetched page (www. ignored) with the default port; otherwise the page's
 * own final URL is credited, so a page cannot point credit elsewhere.
 */
export function creditUrlFor(canonicalHref: string | undefined, fetchedUrl: string): string {
  if (!canonicalHref) return fetchedUrl;
  try {
    const canonical = new URL(canonicalHref, fetchedUrl);
    const fetched = new URL(fetchedUrl);
    if (
      canonical.protocol === "https:" &&
      canonical.port === "" &&
      !canonical.username &&
      !canonical.password &&
      bareHost(canonical.hostname) === bareHost(fetched.hostname)
    ) {
      return canonical.toString();
    }
  } catch {
    // fall through
  }
  return fetchedUrl;
}

/** Pure HTML -> extraction step; used by fetchAndExtract and by tests. */
export function extractFromHtml(html: string, baseUrl: string): UrlExtraction {
  const $ = cheerio.load(html);
  const canonicalUrl = creditUrlFor($('link[rel="canonical"]').first().attr("href"), baseUrl);
  let site = $('meta[property="og:site_name"]').attr("content")?.trim() || undefined;
  if (!site) {
    try {
      site = new URL(baseUrl).hostname;
    } catch {
      site = undefined;
    }
  }
  const recipes = collectJsonLdRecipes($);
  if (recipes.length > 1) {
    throw new Error(
      `Refusing page with ${recipes.length} recipes; single-recipe pages only.`,
    );
  }
  const readable = reduceToReadableText($);
  const rawText = readable.text;
  if (recipes.length === 1) {
    const recipe = recipes[0];
    const title =
      (typeof recipe.name === "string" && recipe.name.trim()) ||
      $("title").first().text().trim() ||
      undefined;
    const author =
      authorName(recipe.author) ?? $('meta[name="author"]').attr("content")?.trim() ?? undefined;
    const ingredientLines = normalizeStringArray(recipe.recipeIngredient);
    return {
      sourceUrl: baseUrl,
      finalUrl: baseUrl,
      canonicalUrl,
      site,
      author,
      title,
      hasJsonLd: true,
      ingredientLines,
      instructionLines: flattenInstructions(recipe.recipeInstructions),
      servingsRaw: normalizeYield(recipe.recipeYield),
      rawText,
      // With JSON-LD ingredient lines the page text is never read, so its cut
      // does not matter; without them the conversion falls back to the text.
      warnings: ingredientLines.length > 0 ? [] : readable.warnings,
    };
  }
  return {
    sourceUrl: baseUrl,
    finalUrl: baseUrl,
    canonicalUrl,
    site,
    author: $('meta[name="author"]').attr("content")?.trim() || undefined,
    title: $("title").first().text().trim() || undefined,
    hasJsonLd: false,
    ingredientLines: [],
    instructionLines: [],
    servingsRaw: undefined,
    rawText,
    warnings: readable.warnings,
  };
}

export async function fetchAndExtract(url: string): Promise<UrlExtraction> {
  const { html, finalUrl } = await fetchHtml(url);
  const extracted = extractFromHtml(html, finalUrl);
  return { ...extracted, sourceUrl: url, finalUrl };
}

// --- Cache normalization ---

const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^msclkid$/i, /^mc_/i, /^igshid$/i];

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const params = new URLSearchParams();
  for (const key of [...url.searchParams.keys()].sort()) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) continue;
    for (const value of url.searchParams.getAll(key)) params.append(key, value);
  }
  url.search = params.toString();
  return url.toString();
}
