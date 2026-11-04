import { Ratelimit } from "@upstash/ratelimit";
import { upstash } from "./cache";

const WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_PER_HOUR = 20;
export const DEFAULT_DAILY_CONVERSION_CAP = 300;

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

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Live conversions per IP per hour: RATE_LIMIT_PER_HOUR (default 20). */
export function ratePerHour(): number {
  return positiveIntFromEnv("RATE_LIMIT_PER_HOUR", DEFAULT_RATE_LIMIT_PER_HOUR);
}

/** Global live conversions per UTC day: DAILY_CONVERSION_CAP (default 300). */
export function dailyCap(): number {
  return positiveIntFromEnv("DAILY_CONVERSION_CAP", DEFAULT_DAILY_CONVERSION_CAP);
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
