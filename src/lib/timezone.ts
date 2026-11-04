/**
 * Zone-aware wall-clock helpers for the Cook Along serving target: the parts
 * of the TextSous app's timezone module that the Cook Along view uses.
 * Browser-safe; every formatter is cached per zone.
 */

/** Fallback zone when the device reports none or an unknown one. */
export const DEFAULT_TIMEZONE = "America/New_York";

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday (matches Date#getDay). */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const validityCache = new Map<string, boolean>();

/** True when `tz` is an IANA zone this runtime's Intl can resolve. */
export function isValidTimezone(tz: string): boolean {
  const cached = validityCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    // Throws RangeError on an unknown identifier.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  validityCache.set(tz, ok);
  return ok;
}

/** Coerce a zone into something Intl accepts; unknown or missing zones fall back. */
export function normalizeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  const trimmed = tz.trim();
  if (!trimmed) return DEFAULT_TIMEZONE;
  return isValidTimezone(trimmed) ? trimmed : DEFAULT_TIMEZONE;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });
    partsFormatters.set(tz, fmt);
  }
  return fmt;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Memoized "3:45 PM" formatter for a zone. */
export function zonedTimeFormatter(tz: string): Intl.DateTimeFormat {
  const zone = normalizeTimezone(tz);
  let fmt = timeFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    });
    timeFormatters.set(zone, fmt);
  }
  return fmt;
}

/** Offset (ms) of `tz` from UTC at the given UTC instant. */
export function tzOffsetMs(tz: string, at: Date): number {
  const zone = normalizeTimezone(tz);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour === 24 ? 0 : (parts.hour ?? 0),
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - at.getTime();
}

/**
 * Convert a wall-clock time in `tz` to the UTC instant. Two-pass fixed point,
 * correct for every zone, including those far east of UTC.
 */
export function wallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const zone = normalizeTimezone(tz);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset1 = tzOffsetMs(zone, new Date(guess));
  const better = guess - offset1;
  const offset2 = tzOffsetMs(zone, new Date(better));
  return new Date(guess - offset2);
}

/** Break `date` into calendar parts as observed in `tz`. */
export function getZonedParts(tz: string, date: Date = new Date()): ZonedParts {
  const zone = normalizeTimezone(tz);
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(zone).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl can emit "24" for midnight with hour12: false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? new Date(date).getDay(),
  };
}
