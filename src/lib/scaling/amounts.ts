/** Parsed amount: a single value (low === high) or a range. */
export interface ParsedAmount {
  low: number;
  high: number;
}

const VULGAR_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 0.1,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const VULGAR_CHARS = Object.keys(VULGAR_FRACTIONS).join("");

function parseSingle(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const vulgar = t.match(new RegExp(`^(\\d+)?\\s*([${VULGAR_CHARS}])$`));
  if (vulgar) {
    return (vulgar[1] ? Number(vulgar[1]) : 0) + VULGAR_FRACTIONS[vulgar[2]];
  }
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed && Number(mixed[3]) !== 0) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction && Number(fraction[2]) !== 0) {
    return Number(fraction[1]) / Number(fraction[2]);
  }
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return Number(t);
  return null;
}

/**
 * Parse a free-text quantity ("1", "1/2", "1 1/2", "½", "2.5", "2-3",
 * "2 to 3") into a low/high pair. Returns null when the text is not an
 * amount ("to taste", ""). The whole string must parse.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  const parts = text.split(/\s*(?:-|–|—)\s*|\s+to\s+/);
  if (parts.length === 2) {
    const low = parseSingle(parts[0]);
    const high = parseSingle(parts[1]);
    if (low !== null && high !== null && low <= high) return { low, high };
    return null;
  }
  if (parts.length !== 1) return null;
  const value = parseSingle(text);
  return value === null ? null : { low: value, high: value };
}

// Mixed numbers stay one token; ranges split ("2-3" -> "2", "3").
const TOKEN_RE = new RegExp(
  `\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|[${VULGAR_CHARS}]`,
  "g",
);

export interface FoundNumber {
  token: string;
  /** Numeric value, or null when the token is not an amount. */
  value: number | null;
  start: number;
  end: number;
}

/** Every numeric token in prose, with character offsets for replacement. */
export function findNumbers(text: string): FoundNumber[] {
  const found: FoundNumber[] = [];
  TOKEN_RE.lastIndex = 0;
  for (;;) {
    const match = TOKEN_RE.exec(text);
    if (!match) break;
    const token = match[0];
    const parsed = parseAmount(token);
    found.push({
      token,
      value: parsed === null ? null : parsed.low === parsed.high ? parsed.low : null,
      start: match.index,
      end: match.index + token.length,
    });
  }
  return found;
}

/** Raw numeric token strings in order, for exact-equality checks. */
export function extractNumericTokens(text: string): string[] {
  return findNumbers(text).map((n) => n.token);
}

const TIMING_RE = /(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)/gi;

/** Numbers directly followed by a time unit, for timing-change detection. */
export function extractTimingNumbers(text: string): number[] {
  const values: number[] = [];
  TIMING_RE.lastIndex = 0;
  for (;;) {
    const match = TIMING_RE.exec(text);
    if (!match) break;
    values.push(Number(match[1]));
  }
  return values.sort((a, b) => a - b);
}
