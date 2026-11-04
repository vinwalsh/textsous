import { findNumbers, type FoundNumber } from "./amounts";
import { formatCookAmount } from "./scale";
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

/**
 * Words that end a number's phrase: a modifier between a number and its unit
 * or name can be any word but these ("2 thick slices bread" yes, "2 and the
 * butter" no).
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "or",
  "then",
  "until",
  "to",
  "into",
  "onto",
  "with",
  "for",
  "in",
  "on",
  "at",
  "of",
  "the",
  "from",
  "over",
  "about",
  "each",
  "per",
  "more",
  "times",
  "batches",
  "batch",
  "rounds",
  "portions",
  "pieces",
  "is",
  "are",
  "if",
  "so",
]);

function isModifier(word: string | undefined): boolean {
  if (word === undefined) return false;
  return ADJECTIVES.has(word) || !STOP_WORDS.has(word);
}

const TIME_AFTER = /^\s*(?:s|secs?|seconds?|mins?|minutes?|hrs?|hours?)\b/i;
/** Always a temperature: a degree sign or word, or F. */
const TEMP_AFTER = /^\s*(?:°|º|degrees?\b|deg\b|f\b)/i;
/** "C" is Celsius only for oven-range numbers; "2 c flour" is cups. */
const CELSIUS_AFTER = /^\s*c\b/i;
/** A package size in parentheses right after an amount: "1 (15-ounce) can". */
const PAREN_AFTER = /^\s*\([^()]*\)/;
const INSIDE_PAREN_AFTER_AMOUNT = /\d\s*\(\s*(?:about\s+|approx\.?\s+)?$/i;
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

/** Short cup spellings the unit table leaves out ("c" is ambiguous there). */
function unitAlias(word: string): string {
  return word === "c" || word === "c." ? "cup" : word;
}

function isUnitWord(word: string, unit: string): boolean {
  const target = unitAlias(unit.trim().toLowerCase().replace(/\.+$/, ""));
  if (!target) return false;
  const a = lookupUnit(unitAlias(word));
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
function namedWithin(words: string[], from: number, name: string): boolean {
  for (let r = from; r <= from + 2 && r < words.length; r += 1) {
    if (r > from && !isModifier(words[r - 1])) break;
    if (nameMatchesAt(words, r, name)) return true;
  }
  return false;
}

/**
 * How well the words after a number identify a mapping: 3 unit then name,
 * 2 unit or name, 0 nothing. Up to two modifiers ("thick", "large") may
 * precede the unit or name, and "of"/"the" may sit between unit and name
 * ("2 cups of the stock"). A unit match that goes on to name a different
 * ingredient ("1 teaspoon of the salt" against 1 teaspoon vanilla) is no
 * match at all.
 */
function score(words: string[], mapping: AmountMapping, otherNames: string[]): number {
  let best = 0;
  for (let p = 0; p <= 2 && p < words.length; p += 1) {
    if (p > 0 && !isModifier(words[p - 1])) break;
    if (mapping.unit && isUnitWord(words[p], mapping.unit)) {
      let q = p + 1;
      while (q < words.length && (words[q] === "of" || words[q] === "the")) q += 1;
      if (namedWithin(words, q, mapping.name)) {
        best = Math.max(best, 3);
      } else if (!otherNames.some((other) => namedWithin(words, q, other))) {
        best = Math.max(best, 2);
      }
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
  | { kind: "map"; next: number; unit: string }
  | { kind: "unmatched" };

function classify(
  text: string,
  found: FoundNumber[],
  index: number,
  mappings: AmountMapping[],
  names: string[],
): Classified {
  const token = found[index];
  const before = text.slice(0, token.start);
  if (PAN_BEFORE.test(before)) return { kind: "skip" };
  // "15" in "1 (15-ounce) can": the package size never scales.
  if (INSIDE_PAREN_AFTER_AMOUNT.test(before)) return { kind: "skip" };
  // A range low end ("2-3 cups") reads its unit after the high end.
  let last = index;
  while (
    last + 1 < found.length &&
    RANGE_GAP.test(text.slice(found[last].end, found[last + 1].start))
  ) {
    last += 1;
  }
  let after = text.slice(found[last].end);
  if (
    TIME_AFTER.test(after) ||
    TEMP_AFTER.test(after) ||
    (CELSIUS_AFTER.test(after) && (found[last].value ?? token.value ?? 0) >= 100) ||
    SIZE_AFTER.test(after) ||
    PAN_AFTER.test(text.slice(token.end))
  ) {
    return { kind: "skip" };
  }
  if (token.value === null) return { kind: "unmatched" };
  after = after.replace(PAREN_AFTER, " ");
  const words = wordsAfter(after);
  const scored = mappings
    .filter((m) => close(m.current, token.value as number))
    .map((m) => ({
      m,
      s: score(
        words,
        m,
        names.filter((n) => normalizeWords(n).join(" ") !== normalizeWords(m.name).join(" ")),
      ),
    }))
    .filter((x) => x.s > 0);
  if (scored.length === 0) return { kind: "unmatched" };
  const top = Math.max(...scored.map((x) => x.s));
  const winners = scored.filter((x) => x.s === top);
  const next = winners[0].m.next;
  if (!winners.every((x) => close(x.m.next, next))) return { kind: "unmatched" };
  return { kind: "map", next, unit: winners[0].m.unit };
}

/**
 * Rescale ingredient amounts inside prose. A number is rescaled only when it
 * equals an ingredient's current amount AND is directly followed (allowing up
 * to two modifiers and a parenthetical package size) by that ingredient's
 * unit or name. Numbers followed by a
 * time unit or temperature, pan sizes (9x13, 12-inch) are left alone and not
 * reported; other unmatched numbers are reported for the cook to verify. Pure.
 */
export function rescaleText(
  text: string,
  mappings: AmountMapping[],
  /** Every ingredient name in the recipe, scaled or not; defaults to the mappings'. */
  names: string[] = mappings.map((m) => m.name),
): RescaledText {
  const found = findNumbers(text);
  const unmatched: string[] = [];
  let out = text;
  const decisions = found.map((_, i) => classify(text, found, i, mappings, names));
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const decision = decisions[i];
    const token = found[i];
    if (decision.kind === "skip") continue;
    if (decision.kind === "unmatched") {
      unmatched.push(token.token);
      continue;
    }
    if (close(decision.next, token.value ?? Number.NaN)) continue;
    // Same rounding as the ingredient list, so the next rescale still matches.
    out = `${out.slice(0, token.start)}${formatCookAmount(decision.next, decision.unit)}${out.slice(token.end)}`;
  }
  return { text: out, unmatched: unmatched.reverse() };
}
