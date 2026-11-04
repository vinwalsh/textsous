import { findNumbers, type FoundNumber } from "./amounts";
import { formatKitchenAmount } from "./scale";
import { lookupUnit } from "./units";

/**
 * One ingredient amount as it currently reads in prose (`current`) and what
 * it becomes after rescaling (`next`). Ranges contribute one mapping per end.
 */
export interface AmountMapping {
  current: number;
  next: number;
  unit: string;
  name: string;
}

export interface RescaledText {
  text: string;
  /** Amount-like numbers that matched no ingredient (cook should verify). */
  unmatched: string[];
}

/** Words allowed between a number and its unit or ingredient ("2 large eggs"). */
const ADJECTIVES = new Set([
  "large",
  "small",
  "medium",
  "big",
  "extra",
  "fresh",
  "heaping",
  "heaped",
  "level",
  "packed",
  "scant",
  "generous",
  "whole",
  "ripe",
  "cold",
  "warm",
  "softened",
  "melted",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "peeled",
  "beaten",
  "boneless",
  "skinless",
  "dried",
  "ground",
  "unsalted",
  "salted",
  "plain",
  "raw",
  "cooked",
  "frozen",
  "canned",
  "red",
  "green",
  "yellow",
  "white",
  "brown",
  "black",
]);

const TIME_AFTER = /^\s*(?:s|secs?|seconds?|mins?|minutes?|hrs?|hours?)\b/i;
const TEMP_AFTER = /^\s*(?:°|º|degrees?\b|deg\b|f\b|c\b)/i;
const SIZE_AFTER = /^\s*-?\s*(?:inch(?:es)?\b|in\.|in\b|"|”|cm\b|mm\b)/i;
const PAN_AFTER = /^\s*[x×]\s*\d/i;
const PAN_BEFORE = /\d\s*[x×]\s*$/i;
const RANGE_GAP = /^\s*(?:-|–|—|to)\s*$/i;

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 0);
}

/** Up to six words directly after a number; stops at sentence punctuation. */
function wordsAfter(after: string): string[] {
  const words: string[] = [];
  let rest = after;
  for (let i = 0; i < 6; i += 1) {
    const match = /^\s*([a-zA-Z]+)\.?/.exec(rest);
    if (!match) break;
    words.push(match[1].toLowerCase());
    rest = rest.slice(match[0].length);
    if (/^\s*[,;:!?()]/.test(rest)) break;
  }
  return words;
}

/** Same word up to a plural ending. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (w: string): string =>
    w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("es") && /(s|x|z|ch|sh|o)es$/.test(w)
      ? w.slice(0, -2)
      : w.endsWith("s") && !w.endsWith("ss")
        ? w.slice(0, -1)
        : w;
  return strip(a) === strip(b);
}

function isUnitWord(word: string, unit: string): boolean {
  const target = unit.trim().toLowerCase().replace(/\.+$/, "");
  if (!target) return false;
  const a = lookupUnit(word);
  const b = lookupUnit(target);
  if (a && b) return a.standard === b.standard;
  return sameWord(word, target);
}

function nameMatchesAt(words: string[], at: number, name: string): boolean {
  const nameWords = normalizeWords(name);
  if (nameWords.length === 0) return false;
  const head = nameWords[nameWords.length - 1];
  // Full name ("red onions") or its head noun ("butter" for "unsalted butter").
  const full = nameWords.every((w, i) => {
    const word = words[at + i];
    if (word === undefined) return false;
    return i === nameWords.length - 1 ? sameWord(word, w) : word === w;
  });
  return full || (words[at] !== undefined && sameWord(words[at], head));
}

/**
 * How well the words after a number identify a mapping: 3 unit then name,
 * 2 unit or name, 0 nothing. Up to two adjectives may precede the unit or
 * name, and "of"/"the" may sit between unit and name ("2 cups of the stock").
 */
function score(words: string[], mapping: AmountMapping): number {
  let best = 0;
  for (let p = 0; p <= 2 && p < words.length; p += 1) {
    if (p > 0 && !ADJECTIVES.has(words[p - 1])) break;
    if (mapping.unit && isUnitWord(words[p], mapping.unit)) {
      let q = p + 1;
      while (q < words.length && (words[q] === "of" || words[q] === "the")) q += 1;
      let named = false;
      for (let r = q; r <= q + 2 && r < words.length; r += 1) {
        if (r > q && !ADJECTIVES.has(words[r - 1])) break;
        if (nameMatchesAt(words, r, mapping.name)) {
          named = true;
          break;
        }
      }
      best = Math.max(best, named ? 3 : 2);
    } else if (nameMatchesAt(words, p, mapping.name)) {
      best = Math.max(best, 2);
    }
  }
  return best;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

type Classified =
  | { kind: "skip" }
  | { kind: "map"; next: number }
  | { kind: "unmatched" };

function classify(
  text: string,
  found: FoundNumber[],
  index: number,
  mappings: AmountMapping[],
): Classified {
  const token = found[index];
  const before = text.slice(0, token.start);
  if (PAN_BEFORE.test(before)) return { kind: "skip" };
  // A range low end ("2-3 cups") reads its unit after the high end.
  let last = index;
  while (
    last + 1 < found.length &&
    RANGE_GAP.test(text.slice(found[last].end, found[last + 1].start))
  ) {
    last += 1;
  }
  const after = text.slice(found[last].end);
  if (
    TIME_AFTER.test(after) ||
    TEMP_AFTER.test(after) ||
    SIZE_AFTER.test(after) ||
    PAN_AFTER.test(text.slice(token.end))
  ) {
    return { kind: "skip" };
  }
  if (token.value === null) return { kind: "unmatched" };
  const words = wordsAfter(after);
  const scored = mappings
    .filter((m) => close(m.current, token.value as number))
    .map((m) => ({ m, s: score(words, m) }))
    .filter((x) => x.s > 0);
  if (scored.length === 0) return { kind: "unmatched" };
  const top = Math.max(...scored.map((x) => x.s));
  const winners = scored.filter((x) => x.s === top);
  const next = winners[0].m.next;
  if (!winners.every((x) => close(x.m.next, next))) return { kind: "unmatched" };
  return { kind: "map", next };
}

/**
 * Rescale ingredient amounts inside prose. A number is rescaled only when it
 * equals an ingredient's current amount AND is directly followed (allowing up
 * to two adjectives) by that ingredient's unit or name. Numbers followed by a
 * time unit or temperature, pan sizes (9x13, 12-inch) are left alone and not
 * reported; other unmatched numbers are reported for the cook to verify. Pure.
 */
export function rescaleText(text: string, mappings: AmountMapping[]): RescaledText {
  const found = findNumbers(text);
  const unmatched: string[] = [];
  let out = text;
  const decisions = found.map((_, i) => classify(text, found, i, mappings));
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const decision = decisions[i];
    const token = found[i];
    if (decision.kind === "skip") continue;
    if (decision.kind === "unmatched") {
      unmatched.push(token.token);
      continue;
    }
    if (close(decision.next, token.value ?? Number.NaN)) continue;
    out = `${out.slice(0, token.start)}${formatKitchenAmount(decision.next)}${out.slice(token.end)}`;
  }
  return { text: out, unmatched: unmatched.reverse() };
}
