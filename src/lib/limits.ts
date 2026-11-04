import { Ratelimit } from "@upstash/ratelimit";
import { upstash } from "./cache";

const WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_PER_HOUR = 20;
export const DEFAULT_DAILY_CONVERSION_CAP = 300;

/**
 * Input ceilings for one daily unit, checked before a unit is reserved. The
 * daily cap counts requests, not tokens, so these keep each paid request
 * near the size of a real recipe (live artifacts are 7-21 KB; a canonical
 * recipe is a few KB). Pasted text has its own 60,000-character limit and
 * the cuisine target its own (MAX_CUISINE_CHARS in schema/variant.ts).
 */
export const MAX_ADJUST_ARTIFACT_CHARS = 64 * 1024;
export const MAX_RECIPE_JSON_CHARS = 60_000;

export type LimitReason = "rate_limited" | "daily_cap";

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  reason?: LimitReason;
}

/** A reserved unit of the daily cap; release() gives it back once. */
export interface DailyReservation extends LimitResult {
  release: () => Promise<void>;
}

/** Contract C2: every 429 body carries a sentence and a machine reason. */
export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  daily_cap:
    "Daily free conversions are used up. Try again tomorrow, or use TextSous from your AI assistant.",
  rate_limited: "Too many conversions from this connection. Wait a few minutes and try again.",
};

export function limitBody(reason: LimitReason): { error: string; reason: LimitReason } {
  return { error: LIMIT_MESSAGES[reason], reason };
}

const memoryHits = new Map<string, number[]>();
let memoryDay = "";
let memoryDayCount = 0;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A whole number from env; unset, blank, junk or below `min` means the default. */
function intFromEnv(name: string, fallback: number, min: number): number {
  const text = (process.env[name] ?? "").trim();
  if (!text) return fallback;
  const raw = Number(text);
  return Number.isFinite(raw) && raw >= min ? Math.floor(raw) : fallback;
}

/**
 * Live requests per IP per hour, per route: convert, adjust and photo each
 * keep their own bucket of RATE_LIMIT_PER_HOUR (default 20). All three draw
 * on the one daily cap below.
 */
export function ratePerHour(): number {
  return intFromEnv("RATE_LIMIT_PER_HOUR", DEFAULT_RATE_LIMIT_PER_HOUR, 1);
}

/**
 * Global live conversions per UTC day: DAILY_CONVERSION_CAP (default 300).
 * 0 pauses every live conversion (cache hits keep working).
 */
export function dailyCap(): number {
  return intFromEnv("DAILY_CONVERSION_CAP", DEFAULT_DAILY_CONVERSION_CAP, 0);
}

/**
 * Per-IP sliding-window limit, Upstash in prod, memory in dev. Call it only
 * for requests that will do live work: cache hits are served before it.
 */
export async function checkRateLimit(ip: string): Promise<LimitResult> {
  const limit = ratePerHour();
  const redis = upstash();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, "1 h"),
      prefix: "textsous:ratelimit",
    });
    const { success, remaining } = await limiter.limit(`convert:${ip}`);
    return success
      ? { allowed: true, remaining }
      : { allowed: false, remaining: 0, reason: "rate_limited" };
  }
  const now = Date.now();
  const hits = (memoryHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= limit) {
    return { allowed: false, remaining: 0, reason: "rate_limited" };
  }
  hits.push(now);
  memoryHits.set(ip, hits);
  return { allowed: true, remaining: limit - hits.length };
}

/**
 * Reserve one unit of the global daily cap. Call it only when a live model
 * call is about to start (after the cache miss and a successful page fetch
 * or input validation). A refused reservation takes nothing; an accepted one
 * can be released when the request fails before any model tokens are spent.
 */
export async function reserveDailyUnit(): Promise<DailyReservation> {
  const cap = dailyCap();
  const redis = upstash();
  const day = todayKey();
  const noop = async (): Promise<void> => {};
  if (redis) {
    const key = `textsous:daily:${day}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60 * 60 * 24 * 2);
    if (count > cap) {
      await redis.decr(key).catch(() => 0);
      return { allowed: false, remaining: 0, reason: "daily_cap", release: noop };
    }
    let released = false;
    return {
      allowed: true,
      remaining: cap - count,
      release: async () => {
        if (released) return;
        released = true;
        await redis.decr(key).catch(() => 0);
      },
    };
  }
  if (memoryDay !== day) {
    memoryDay = day;
    memoryDayCount = 0;
  }
  if (memoryDayCount >= cap) {
    return { allowed: false, remaining: 0, reason: "daily_cap", release: noop };
  }
  memoryDayCount += 1;
  let released = false;
  return {
    allowed: true,
    remaining: cap - memoryDayCount,
    release: async () => {
      if (released) return;
      released = true;
      if (memoryDay === day && memoryDayCount > 0) memoryDayCount -= 1;
    },
  };
}

/** Reserve without the ability to release (kept for existing callers). */
export async function checkDailyCap(): Promise<LimitResult> {
  const { allowed, remaining, reason } = await reserveDailyUnit();
  return reason ? { allowed, remaining, reason } : { allowed, remaining };
}

/** Test hook: forget in-memory counters. */
export function resetMemoryLimits(): void {
  memoryHits.clear();
  memoryDay = "";
  memoryDayCount = 0;
}
