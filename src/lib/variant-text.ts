/**
 * Deterministic rewording of recipe prose after a dietary or cuisine swap:
 * replace a swapped ingredient's name with its substitute, or drop the
 * clause for a removed one. Used when the model gives no override for a task
 * or step that still names the old ingredient. Pure.
 */

export interface TextSwap {
  /** Name before the swap, as printed in the ingredient list. */
  oldName: string;
  /** Substitute name, or null when the ingredient is removed. */
  newName: string | null;
  /** Bare head noun ("butter" for "unsalted butter"), when it is unambiguous. */
  head: string | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Phrase to a regex source: words separated by whitespace, last word plural aware. */
function phraseSource(name: string): string | null {
  const list = words(name);
  if (list.length === 0) return null;
  const last = list.pop() as string;
  const lastSource = /[^aeiou]y$/.test(last)
    ? `${escapeRegExp(last.slice(0, -1))}(?:y|ies)`
    : `${escapeRegExp(last)}(?:s|es)?`;
  return [...list.map(escapeRegExp), lastSource].join("[\\s-]+");
}

/**
 * Head nouns usable as a bare mention: the last word of a multi-word name,
 * only when no other ingredient shares it ("oil" is ambiguous with two oils).
 */
export function uniqueHeads(names: string[]): Map<string, string | null> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const list = words(name);
    const head = list[list.length - 1];
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  const out = new Map<string, string | null>();
  for (const name of names) {
    const list = words(name);
    const head = list[list.length - 1];
    out.set(
      name,
      head && list.length > 1 && head.length >= 3 && counts.get(head) === 1 ? head : null,
    );
  }
  return out;
}

function alternation(sources: Array<string | null>): string | null {
  const list = sources.filter((s): s is string => s !== null && s.length > 0);
  if (list.length === 0) return null;
  return list.sort((a, b) => b.length - a.length).join("|");
}

/**
 * Regex whose group 1 matches a protected phrase (a substitute name, left
 * alone) and group 2 matches a mention of the old ingredient.
 */
function mentionRegex(swap: TextSwap, protectedNames: string[]): RegExp | null {
  const target = alternation([phraseSource(swap.oldName), swap.head ? phraseSource(swap.head) : null]);
  if (!target) return null;
  const shield = alternation(protectedNames.map(phraseSource));
  // Without protected names, group 1 can never match.
  const source = shield
    ? `\\b(${shield})\\b|\\b(${target})\\b`
    : `(?!)()|\\b(${target})\\b`;
  return new RegExp(source, "gi");
}

/** True when the text names the old ingredient outside any protected phrase. */
export function mentions(text: string, swap: TextSwap, protectedNames: string[]): boolean {
  const re = mentionRegex(swap, protectedNames);
  if (!re) return false;
  for (const match of text.matchAll(re)) {
    if (match[2] !== undefined) return true;
  }
  return false;
}

function matchCase(replacement: string, original: string): string {
  if (original && original[0] === original[0].toUpperCase() && /[a-z]/i.test(original[0])) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const AMOUNT =
  "(?:(?:\\d+(?:[./]\\d+)?(?:\\s+\\d+/\\d+)?|[½¼¾⅓⅔⅛])\\s*(?:[a-zA-Z]+\\.?\\s+)?(?:of\\s+)?)?";

/** Prep words that belong to the mention ("grated", "freshly ground"). */
const MODIFIERS =
  "(?:(?:freshly|finely|coarsely|roughly|thinly|lightly|fresh|toasted|[a-z]+ed)\\s+){0,3}";

/**
 * Verbs that start a new clause after "and"/"then". "parmesan and serve" is
 * not a list, so removing the parmesan must not leave "with serve".
 */
const CLAUSE_VERBS = [
  "add", "adjust", "allow", "arrange", "bake", "beat", "blend", "boil", "bring", "check",
  "chill", "chop", "combine", "continue", "cook", "cool", "cover", "cut", "discard",
  "divide", "drain", "drizzle", "enjoy", "finish", "flip", "fold", "fry", "garnish",
  "grill", "heat", "keep", "knead", "leave", "let", "mash", "melt", "mix", "place",
  "plate", "pour", "press", "reduce", "remove", "repeat", "rest", "return", "rinse",
  "roast", "roll", "saute", "sauté", "scatter", "scrape", "season", "serve", "set",
  "shape", "simmer", "slice", "spoon", "spread", "sprinkle", "squeeze", "stir", "taste",
  "toast", "top", "toss", "transfer", "turn", "use", "wait", "warm", "whisk",
];
const VERB_AHEAD = `(?!(?:${CLAUSE_VERBS.join("|")})\\b)`;
const CLAUSE_SPLIT = new RegExp(`\\s*[,;]\\s*|\\s+(?:and|then|and then)\\s+(?=(?:${CLAUSE_VERBS.join("|")})\\b)`, "i");

function capitalizeLike(result: string, original: string): string {
  const trimmed = result.replace(/\s+([,.;!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (!trimmed) return trimmed;
  if (/^[A-Z]/.test(original.trim()) && /^[a-z]/.test(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed;
}

function removeMention(text: string, swap: TextSwap, protectedNames: string[]): string {
  const target = alternation([phraseSource(swap.oldName), swap.head ? phraseSource(swap.head) : null]);
  if (!target) return text;
  let out = text;
  // List shapes first: "a, b and X", "a and the X", "X and b", "X, b".
  // Amount, unit and prep words go with the name, so nothing is left hanging
  // ("1/4 cup grated"); a conjunction followed by a verb is not a list.
  const mention = `(?:the\\s+)?${AMOUNT}${MODIFIERS}(?:${target})\\b`;
  const patterns = [
    new RegExp(`,?\\s+(?:and|or|&)\\s+${mention}`, "gi"),
    new RegExp(`,\\s*${mention}(?=\\s*(?:,|and\\s+${VERB_AHEAD}|or\\b))`, "gi"),
    new RegExp(`\\b${mention}\\s*(?:,\\s*${VERB_AHEAD}|\\s+(?:and|or|&)\\s+${VERB_AHEAD})`, "gi"),
  ];
  for (const [index, pattern] of patterns.entries()) {
    if (!mentions(out, swap, protectedNames)) break;
    if (index > 0) {
      out = out.replace(pattern, "");
      continue;
    }
    // "a, b, and X" -> "a and b": the list keeps its conjunction.
    for (;;) {
      pattern.lastIndex = 0;
      const match = pattern.exec(out);
      if (!match) break;
      let prefix = out.slice(0, match.index);
      const clauseStart = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("."), prefix.lastIndexOf(":"));
      const comma = prefix.lastIndexOf(", ");
      if (comma > clauseStart) {
        const conj = /\bor\b/i.test(match[0]) ? "or" : "and";
        prefix = `${prefix.slice(0, comma)} ${conj} ${prefix.slice(comma + 2)}`;
      }
      out = `${prefix}${out.slice(match.index + match[0].length)}`;
    }
  }
  if (!mentions(out, swap, protectedNames)) return capitalizeLike(out, text);
  // Still named as the only object: drop each clause or sentence naming it.
  const sentences = out.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (!mentions(sentence, swap, protectedNames)) {
      kept.push(sentence);
      continue;
    }
    const end = /[.!?]$/.test(sentence) ? sentence.slice(-1) : "";
    const body = end ? sentence.slice(0, -1) : sentence;
    const clauses = body.split(CLAUSE_SPLIT).filter((c) => !mentions(c, swap, protectedNames));
    if (clauses.length > 0) {
      let joined = clauses.join(", ");
      if (/^[A-Z]/.test(sentence.trim())) joined = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
      kept.push(`${joined}${end}`);
    }
  }
  return capitalizeLike(kept.join(" "), text);
}

/**
 * Reword one piece of prose for a swap. Substitute names already present are
 * protected, so "vegan butter" never becomes "vegan vegan butter". Returns
 * the text unchanged when it does not name the old ingredient; may return
 * "" when a removal leaves nothing.
 */
export function rewordForSwap(text: string, swap: TextSwap, protectedNames: string[]): string {
  if (!mentions(text, swap, protectedNames)) return text;
  if (swap.newName === null) return removeMention(text, swap, protectedNames);
  const re = mentionRegex(swap, protectedNames);
  if (!re) return text;
  const replacement = swap.newName;
  return text.replace(re, (match: string, shielded: string | undefined) =>
    shielded !== undefined && shielded !== "" ? match : matchCase(replacement, match),
  );
}

/** Apply every swap in order. */
export function rewordForSwaps(text: string, swaps: TextSwap[], protectedNames: string[]): string {
  let out = text;
  for (const swap of swaps) out = rewordForSwap(out, swap, protectedNames);
  return out;
}

/** True when any swap's old ingredient is still named. */
export function mentionsAny(text: string, swaps: TextSwap[], protectedNames: string[]): boolean {
  return swaps.some((swap) => mentions(text, swap, protectedNames));
}
