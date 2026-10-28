import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const MAX_RAW_TEXT_CHARS = 20_000;

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
    inCidr("192.0.2.0", 24) ||
    inCidr("198.51.100.0", 24) ||
    inCidr("203.0.113.0", 24) ||
    inCidr("224.0.0.0", 4) ||
    inCidr("240.0.0.0", 4)
  );
}

function ipv6IsPrivate(literal: string): boolean {
  const h = literal.toLowerCase();
  if (h === "::1" || h === "::") return true;
  // Embedded IPv4 (e.g. ::ffff:192.168.0.1)
  const v4Match = h.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const n = ipv4ToInt(v4Match[1]);
    return n === null || ipv4IsPrivate(n);
  }
  const first = h.split(":").find((g) => g.length > 0) ?? "";
  const group = Number.parseInt(first, 16);
  if (Number.isNaN(group)) return true;
  if ((group & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((group & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
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

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
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
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = (await assertPublicHttpsUrl(startUrl)).toString();
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
      clearTimeout(timeout);
      if ((error as Error).name === "AbortError") {
        throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms.`);
      }
      throw new Error(`Fetch failed: ${(error as Error).message}`);
    }
    clearTimeout(timeout);
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
    return { html: await readCapped(response), finalUrl: current };
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

function reduceToReadableText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, template").remove();
  const article = $("article").first();
  const main = $("main").first();
  const root = article.length > 0 ? article : main.length > 0 ? main : $("body");
  root.find("nav, header, footer, aside").remove();
  const text = root.text().replace(/\s+/g, " ").trim();
  return text.length > MAX_RAW_TEXT_CHARS ? text.slice(0, MAX_RAW_TEXT_CHARS) : text;
}

/** Pure HTML -> extraction step; used by fetchAndExtract and by tests. */
export function extractFromHtml(html: string, baseUrl: string): UrlExtraction {
  const $ = cheerio.load(html);
  let canonicalUrl = baseUrl;
  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, baseUrl).toString();
    } catch {
      // keep baseUrl
    }
  }
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
  const rawText = reduceToReadableText($);
  if (recipes.length === 1) {
    const recipe = recipes[0];
    const title =
      (typeof recipe.name === "string" && recipe.name.trim()) ||
      $("title").first().text().trim() ||
      undefined;
    const author =
      authorName(recipe.author) ?? $('meta[name="author"]').attr("content")?.trim() ?? undefined;
    return {
      sourceUrl: baseUrl,
      finalUrl: baseUrl,
      canonicalUrl,
      site,
      author,
      title,
      hasJsonLd: true,
      ingredientLines: normalizeStringArray(recipe.recipeIngredient),
      instructionLines: flattenInstructions(recipe.recipeInstructions),
      servingsRaw: normalizeYield(recipe.recipeYield),
      rawText,
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
