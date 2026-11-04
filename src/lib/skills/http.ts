import { createHash, timingSafeEqual } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { upstash } from "../cache";

/** Request bodies above this are refused with 413 (contract C3). */
export const MAX_SKILLS_BODY_BYTES = 256 * 1024;
export const SECRET_LIMIT_PER_HOUR = 600;
export const ACCOUNT_LIMIT_PER_HOUR = 60;
export const DEFAULT_PUBLIC_ORIGIN = "https://open.textsous.com";

export type SkillsFailureCode =
  | "not_configured"
  | "unauthorized"
  | "too_large"
  | "invalid_json"
  | "rate_limited"
  | "internal";

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function failure(status: number, code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** Constant-time comparison (hashing first makes lengths equal). */
export function secretsMatch(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected)) && given.length > 0;
}

/**
 * Secret check for the two secret routes: 503 when SKILLS_API_SECRET is
 * unset on this server, 401 when the bearer is missing or wrong, else null.
 */
export function checkSecret(req: Request): Response | null {
  const expected = process.env.SKILLS_API_SECRET?.trim();
  if (!expected) {
    return failure(503, "not_configured", "The skills API is not configured on this server (SKILLS_API_SECRET is unset).");
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !secretsMatch(match[1].trim(), expected)) {
    return failure(401, "unauthorized", "Send Authorization: Bearer <the skills API secret>.");
  }
  return null;
}

/** Read a JSON body under the byte cap. Returns the value or an error response. */
export async function readJsonBody(req: Request, maxBytes = MAX_SKILLS_BODY_BYTES): Promise<{ value: unknown } | { response: Response }> {
  const tooLarge = (): { response: Response } => ({
    response: failure(413, "too_large", `The request body is over ${Math.round(maxBytes / 1024)} KB. Send a shorter source.text.`),
  });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return tooLarge();
        }
        chunks.push(value);
      }
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { response: failure(400, "invalid_json", "The request body must be JSON.") };
  }
}

const memoryHits = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;

async function hit(key: string, limit: number): Promise<boolean> {
  const redis = upstash();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, "1 h"),
      prefix: "textsous:skills",
    });
    const { success } = await limiter.limit(key);
    return success;
  }
  const now = Date.now();
  const hits = (memoryHits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= limit) {
    memoryHits.set(key, hits);
    return false;
  }
  hits.push(now);
  memoryHits.set(key, hits);
  return true;
}

/**
 * Skills rate limits: 600 requests/hour per secret, plus 60/hour per
 * X-TextSous-Account (an opaque hash the caller sends). Separate from the
 * site's conversion limits and daily cap: skills calls spend no model tokens.
 */
export async function checkSkillsRateLimit(req: Request): Promise<Response | null> {
  const secret = process.env.SKILLS_API_SECRET?.trim() ?? "";
  const secretKey = `secret:${sha256(secret).toString("hex").slice(0, 16)}`;
  if (!(await hit(secretKey, SECRET_LIMIT_PER_HOUR))) {
    return failure(429, "rate_limited", "Too many skills requests this hour. Try again later.");
  }
  const account = (req.headers.get("x-textsous-account") ?? "").trim();
  if (account) {
    const accountKey = `account:${sha256(account.slice(0, 256)).toString("hex").slice(0, 32)}`;
    if (!(await hit(accountKey, ACCOUNT_LIMIT_PER_HOUR))) {
      return failure(429, "rate_limited", "This account made too many cook along requests this hour. Try again later.");
    }
  }
  return null;
}

/** Test hook: clear the in-memory limiter. */
export function resetSkillsRateLimits(): void {
  memoryHits.clear();
}

/**
 * Origin for viewUrl and artifactUrl: PUBLIC_ORIGIN when set; on Vercel
 * production https://open.textsous.com; otherwise the request origin (local
 * runs and preview deployments).
 */
export function publicOrigin(req: Request): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return DEFAULT_PUBLIC_ORIGIN;
  return new URL(req.url).origin;
}

export function buildViewUrl(origin: string, artifactUrl: string): string {
  return `${origin}/?src=${encodeURIComponent(artifactUrl)}`;
}
