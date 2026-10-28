import { Ratelimit } from "@upstash/ratelimit";
import { upstash } from "./cache";

const MAX_PER_IP_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  reason?: "rate_limited" | "daily_cap";
}

const memoryHits = new Map<string, number[]>();
let memoryDay = "";
let memoryDayCount = 0;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Per-IP rate limit: 20 conversions/hour, Upstash in prod, memory in dev. */
export async function checkRateLimit(ip: string): Promise<LimitResult> {
  const redis = upstash();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_PER_IP_PER_HOUR, "1 h"),
      prefix: "textsous:ratelimit",
    });
    const { success, remaining } = await limiter.limit(`convert:${ip}`);
    return success
      ? { allowed: true, remaining }
      : { allowed: false, remaining: 0, reason: "rate_limited" };
  }
  const now = Date.now();
  const hits = (memoryHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_IP_PER_HOUR) {
    return { allowed: false, remaining: 0, reason: "rate_limited" };
  }
  hits.push(now);
  memoryHits.set(ip, hits);
  return { allowed: true, remaining: MAX_PER_IP_PER_HOUR - hits.length };
}

export function dailyCap(): number {
  const raw = Number(process.env.DAILY_CONVERSION_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

/** Global daily conversion cap from env (default 100). Counts live conversions only. */
export async function checkDailyCap(): Promise<LimitResult> {
  const cap = dailyCap();
  const redis = upstash();
  const day = todayKey();
  if (redis) {
    const key = `textsous:daily:${day}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60 * 60 * 24 * 2);
    return count <= cap
      ? { allowed: true, remaining: cap - count }
      : { allowed: false, remaining: 0, reason: "daily_cap" };
  }
  if (memoryDay !== day) {
    memoryDay = day;
    memoryDayCount = 0;
  }
  memoryDayCount += 1;
  return memoryDayCount <= cap
    ? { allowed: true, remaining: cap - memoryDayCount }
    : { allowed: false, remaining: 0, reason: "daily_cap" };
}
