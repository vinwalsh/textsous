/**
 * Deterministic output-format helpers that run after the model: title
 * cleanup, card-title cleanup, timing-label repair and the coded format
 * warnings. Pure functions, no model calls, safe for offline tests.
 */
import type { CanonicalRecipe } from "./schema/canonical";
import type { CardTitleSchema, TimelineDefinition, TimelineTask } from "./schema/timeline";
import type { z } from "zod";

type CardTitle = z.infer<typeof CardTitleSchema>;

// ---------------------------------------------------------------------------
// Recipe titles
// ---------------------------------------------------------------------------

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

/** Marketing phrases that are never part of a dish's name. */
const MARKETING = [
  "best[- ]ever",
  "the best ever",
  "the very best",
  "the best",
  "world'?s best",
  "my favou?rite",
  "our favou?rite",
  "best",
  "easiest",
  "super easy",
  "quick (?:and|&) easy",
  "easy",
  "ultimate",
  "perfect",
  "amazing",
  "foolproof",
  "fool-proof",
  "must[- ]try",
  "to die for",
  "so good",
  "the only",
];
const MARKETING_ALT = MARKETING.join("|");
const LEADING_MARKETING_RE = new RegExp(`^(?:(?:${MARKETING_ALT})!?)\\s+`, "i");
const TRAILING_MARKETING_RE = new RegExp(`\\s+(?:${MARKETING_ALT})!*$`, "i");
const MARKETING_ONLY_RE = new RegExp(
  `^(?:(?:${MARKETING_ALT}|video|with video|recipe|recipes|step[- ]by[- ]step|how to make it|one[- ]pot|30[- ]minute)!?[\\s,&+]*)+$`,
  "i",
);
// Tags written with an exclamation mark anywhere ("Easy!", "So Good!").
const EXCLAIMED_TAG_RE = new RegExp(`(^|\\s)(?:${MARKETING_ALT})!+(?=\\s|$)`, "gi");

function siteMatches(segment: string, site: string | null | undefined): boolean {
  if (!site) return false;
  const norm = (s: string) => s.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]/g, "");
  const a = norm(segment);
  const b = norm(site.replace(/\.(com|net|org|co\.uk|co|io|blog)$/i, ""));
  return a.length > 0 && b.length > 0 && (a === b || a === norm(site));
}

function isDroppableSegment(segment: string, site: string | null | undefined): boolean {
  const s = segment.trim();
  if (!s) return true;
  if (siteMatches(s, site)) return true;
  if (/^[a-z0-9-]+\.(com|net|org|co\.uk|co|io|blog)$/i.test(s)) return true;
  return MARKETING_ONLY_RE.test(s);
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Strip what is not the dish's name: emoji, site names, a trailing "Recipe",
 * and marketing tags ("Easy!", "Best Ever"). Deterministic; never changes
 * letter case; returns the trimmed original if nothing would be left.
 */
export function cleanTitle(raw: string, site?: string | null): string {
  const original = raw.replace(/\s+/g, " ").trim();
  let t = original.replace(EMOJI_RE, " ").replace(/\s+/g, " ").trim();

  // Bracketed tags: "(Easy!)", "[Video]", "(Best Ever)".
  t = t.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) =>
    isDroppableSegment(inner, site) ? " " : whole,
  );

  // Spaced separators: "Chicken Tacos | Smitten Kitchen", "Best Ever - Stew".
  const parts = t.split(/\s+[|–—•·:-]\s+|\s*\|\s*/);
  if (parts.length > 1) {
    const kept = parts.filter((p) => !isDroppableSegment(p, site));
    if (kept.length > 0) t = kept.join(" - ");
  }

  t = t.replace(EXCLAIMED_TAG_RE, "$1");
  t = t.replace(/^recipe\s*[:\-–—]\s*/i, "");
  for (let i = 0; i < 4; i += 1) {
    const before = t;
    t = t.replace(/[\s,:;|\-–—!]+$/g, "").trim();
    t = t.replace(/\s+recipes?$/i, "");
    if (words(t) > 2) t = t.replace(TRAILING_MARKETING_RE, "");
    const lead = t.replace(LEADING_MARKETING_RE, "");
    if (words(lead) >= 2) t = lead;
    if (t === before) break;
  }
  t = t.replace(/\s+/g, " ").replace(/^[\s,:;|\-–—]+|[\s,:;|\-–—]+$/g, "").trim();
  return t.length > 0 ? t : original;
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

/** "1½" -> "1 1/2", "1-1/2" -> "1 1/2", "½" -> "1/2", "1⁄2" -> "1/2". */
export function normalizeFractions(text: string): string {
  let t = text.replace(/⁄/g, "/");
  t = t.replace(/(\d)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_m, d: string, f: string) => `${d} ${UNICODE_FRACTIONS[f]}`);
  t = t.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => UNICODE_FRACTIONS[f]);
  t = t.replace(/(\d)-(\d+\/\d+)/g, "$1 $2");
  return t;
}

const NUMBER_WORDS: Record<string, string[]> = {
  "1": ["one"],
  "2": ["two"],
  "3": ["three"],
  "4": ["four"],
  "5": ["five"],
  "6": ["six"],
  "1/2": ["half", "a half"],
  "1/4": ["a quarter", "quarter"],
};

const UNIT_WORDS =
  "cups?|c\\.|tablespoons?|tbsps?|tbs|tbsp\\.|teaspoons?|tsps?|tsp\\.|ounces?|oz\\.?|fl\\.? oz|pounds?|lbs?\\.?|grams?|g|kilograms?|kg|milliliters?|millilitres?|ml|liters?|litres?|l|pints?|quarts?|gallons?|cloves?|cans?|sticks?|pinch(?:es)?|dash(?:es)?|slices?|sprigs?|bunch(?:es)?|heads?|stalks?|handfuls?|packages?|pkg|jars?|inch(?:es)?|cm|mm";

const AMOUNT_RE = new RegExp(
  `(?:\\b\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\/\\d+|\\/\\d+)?|\\b\\d+\\/\\d+|[½⅓⅔¼¾⅛⅜⅝⅞])(?:\\s*(?:-|–|to)\\s*\\d+(?:\\/\\d+)?)?\\s*(?:(?:${UNIT_WORDS})\\b\\.?)?(?:\\s+of\\b)?`,
  "gi",
);
const TIME_RE =
  /\b(?:for\s+|about\s+|around\s+|approximately\s+|approx\.?\s+|~\s*)?\d+(?:[.,]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?\s*(?:minutes?|mins?\.?|hours?|hrs?\.?|seconds?|secs?\.?)\b(?:\s+(?:per|a|each|on each)\s+(?:side|batch|round))?/gi;
const TEMP_RE =
  /\b(?:at\s+|to\s+)?\d{2,3}\s*(?:°|º|degrees?)\s*(?:[FC]\b|fahrenheit|celsius)?(?:\s*\/\s*\d{2,3}\s*(?:°|º)\s*[FC]?)?/gi;

const SIZE_RE =
  /\b\d+(?:[./]\d+)?(?:\s+\d+\/\d+)?(?:\s*|-)(?:inch|in\.|cm|mm)(?:-(?:thick|wide|long))?\b|[½¼¾⅓⅔⅛](?:\s*|-)(?:inch|cm)(?:-(?:thick|wide|long))?\b/gi;

function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,;:·\-–—]+|[\s,;:·\-–—]+$/g, "")
    .replace(/^(?:of|for|at|about)\s+/i, "")
    .replace(/\s+(?:for|at|to|about|over|with|of)$/i, "")
    .trim();
}

/** Remove amounts, times and temperatures from one title field. */
export function stripAmountsTimesTemps(text: string): string {
  const stripped = text
    .replace(SIZE_RE, " ")
    .replace(TIME_RE, " ")
    .replace(TEMP_RE, " ")
    .replace(AMOUNT_RE, " ");
  if (stripped === text) return text;
  return tidy(stripped);
}

/**
 * Card titles (action, subject, context) never carry amounts, times or
 * temperatures; descriptions do. A field that would end up empty keeps its
 * original text for action and subject (both required) and becomes "" for
 * context.
 */
export function cleanCardTitle(card: CardTitle): CardTitle {
  const action = stripAmountsTimesTemps(card.action);
  const subject = stripAmountsTimesTemps(card.subject);
  const context = stripAmountsTimesTemps(card.context);
  return {
    action: action || card.action,
    subject: subject || card.subject,
    context,
  };
}

/** First sentence of a string ("A. B." -> "A."); trimmed; empty -> null. */
export function firstSentence(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  const match = /^.*?[.!?](?=\s+[A-Z(]|$)/s.exec(t);
  return (match ? match[0] : t).trim();
}

// ---------------------------------------------------------------------------
// Timeline polish (runs after the procedure model call)
// ---------------------------------------------------------------------------

/** Every string the model may quote a source timing from. */
export function sourceTimingPool(recipe: CanonicalRecipe): string {
  return [
    recipe.title,
    ...recipe.ingredients.flatMap((ing) => [ing.name, ing.quantity, ing.unit, ing.note ?? ""]),
    ...recipe.steps.map((s) => s.text),
  ].join("\n");
}

export interface PolishResult {
  timeline: TimelineDefinition;
  /** Readable notes on what code repaired. */
  repairs: string[];
}

/**
 * Deterministic clean-up of the model's timeline:
 * - card titles lose amounts, times and temperatures;
 * - `why` is one sentence, `tip` stays one tip (empty strings become null);
 * - a "source" timing whose quote is not verbatim in the source becomes an
 *   estimate (never the other way round); estimates carry no quote;
 * - an estimate whose description repeats the source's own time phrase for
 *   it (cited step, matching minutes) is labeled "source" with that quote;
 * - capitalized free-text quantities are lowered mid-sentence;
 * - timers default on only for exact source timings.
 * Ids, dependencies, lanes and minutes are never touched.
 */
export function polishTimeline(recipe: CanonicalRecipe, timeline: TimelineDefinition): PolishResult {
  const pool = sourceTimingPool(recipe);
  const stepText = new Map(recipe.steps.map((step) => [step.id, step.text] as const));
  const repairs: string[] = [];
  const tasks = timeline.tasks.map((task): TimelineTask => {
    const next: TimelineTask = { ...task, cardTitle: cleanCardTitle(task.cardTitle) };
    if (task.why !== undefined) next.why = firstSentence(task.why);
    if (typeof task.tip === "string") next.tip = task.tip.trim() || null;
    const quote = (task.sourceQuote ?? "").trim();
    if (task.timingBasis === "source") {
      if (!quote || !pool.includes(quote)) {
        next.timingBasis = "estimate";
        next.sourceQuote = null;
        repairs.push(
          `Timing for ${task.label} is now marked as an estimate: its quote is not word for word in the recipe.`,
        );
      } else {
        next.sourceQuote = quote;
      }
    } else if (task.sourceQuote) {
      next.sourceQuote = null;
    }
    if (next.timingBasis === "estimate") {
      const found = sourceTimingInDescription(next, stepText);
      if (found) {
        next.timingBasis = "source";
        next.sourceQuote = found.quote;
        if (found.range && !next.range) next.range = found.range;
      }
    }
    next.description = lowerMidSentenceQuantities(next.description, recipe);
    next.timerEnabledByDefault = next.timingBasis === "source";
    return next;
  });
  return { timeline: { ...timeline, tasks }, repairs };
}

const NUM = "(\\d+(?:[.,]\\d+)?)";
const TIME_PHRASE_RE = new RegExp(
  `\\b(?:(?:about|for|around|approximately|another)\\s+)?${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?\\s*(?:more\\s+)?(?:minutes?|mins?)\\b`,
  "gi",
);
const PER_ROUND_AFTER_RE = /^\s*(?:per|each|a|on each)\s+(?:side|batch|round)/i;

/**
 * A task labeled "estimate" whose description repeats exactly one time
 * phrase that appears word for word in one of its cited steps, and whose
 * minutes match it, is timed by the source: label it so, with that quote.
 * Per-side and per-batch times are never promoted (batches are estimates).
 */
export function sourceTimingInDescription(
  task: Pick<TimelineTask, "description" | "minutes" | "sourceStepIds">,
  stepText: Map<string, string>,
): { quote: string; range?: { low: number; high: number } } | null {
  const matches = [...task.description.matchAll(TIME_PHRASE_RE)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const after = task.description.slice((m.index ?? 0) + m[0].length);
  if (PER_ROUND_AFTER_RE.test(after)) return null;
  const quote = m[0];
  const cited = task.sourceStepIds.map((id) => stepText.get(id) ?? "");
  const inStep = cited.find((text) => text.includes(quote));
  if (inStep === undefined) return null;
  const afterInStep = inStep.slice(inStep.indexOf(quote) + quote.length);
  if (PER_ROUND_AFTER_RE.test(afterInStep)) return null;
  const low = Number(m[1].replace(",", "."));
  const high = m[2] !== undefined ? Number(m[2].replace(",", ".")) : undefined;
  if (high === undefined) return task.minutes === low ? { quote } : null;
  if (task.minutes < low || task.minutes > high) return null;
  return { quote, range: { low: Math.ceil(low), high: Math.floor(high) } };
}

/**
 * Quantities printed with a capital ("Half a", "Handful", "Many grinds")
 * read wrong mid-sentence: lower the first letter there.
 */
export function lowerMidSentenceQuantities(text: string, recipe: CanonicalRecipe): string {
  let out = text;
  for (const ing of recipe.ingredients) {
    const q = ing.quantity.trim();
    if (!/^[A-Z][a-z]/.test(q)) continue;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`([a-z,;:]\\s+)${escaped}\\b`, "g"), (_m, pre: string) => `${pre}${q[0].toLowerCase()}${q.slice(1)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coded format warnings (non-blocking)
// ---------------------------------------------------------------------------

export type FormatWarningCode =
  | "prep_not_covered"
  | "amount_missing"
  | "batch_round_timing";

export interface FormatWarning {
  code: FormatWarningCode;
  message: string;
  taskId?: string;
  ingredientId?: string;
}

/** Prep words that call for a mise-en-place task when they appear in a line. */
const PREP_RE =
  /\b(trimmed|trim|sliced|slice|thinly sliced|diced|dice|minced|mince|chopped|chop|finely chopped|roughly chopped|grated|grate|zested|zest(?:ed)? and juiced|juiced|peeled|peel|cubed|crushed|julienned|shredded|halved|quartered|cored|seeded|deseeded|pitted|torn|cut into|cut in|smashed|softened|at room temperature|room temperature|beaten|whisked|sifted|drained|rinsed|patted dry|thawed|cut)\b/i;

/** The ingredient asks for a preparation (in its note or its name). */
export function prepNoteOf(ingredient: { name: string; note?: string | null }): string | null {
  const note = ingredient.note ?? "";
  const m = PREP_RE.exec(note) ?? PREP_RE.exec(ingredient.name);
  return m ? m[0].toLowerCase() : null;
}

function quantityForms(quantity: string): string[] {
  const q = normalizeFractions(quantity).trim().toLowerCase();
  if (!q) return [];
  const forms = new Set<string>([q]);
  const first = q.split(/\s*(?:-|–|to)\s*/)[0];
  if (first) forms.add(first);
  for (const word of NUMBER_WORDS[q] ?? []) forms.add(word);
  return [...forms];
}

function hasForm(text: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern = /^[a-z ]+$/i.test(form)
    ? `\\b${escaped}\\b`
    : `(^|[^\\d/.])${escaped}(?![\\d/]|\\.\\d)`;
  return new RegExp(pattern, "i").test(text);
}

const ANY_AMOUNT_RE = /(\b\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\/\d+)?\b|\b(?:one|two|three|four|five|six|half|a quarter)\b)/i;

function isDivided(ingredient: { note?: string | null }): boolean {
  return /\b(divided|separated|plus more|plus extra|reserved?)\b/i.test(ingredient.note ?? "");
}

/**
 * Format warnings, never blocking:
 * - prep_not_covered: an ingredient whose line or note names a preparation
 *   (diced, minced, sliced...) that no prep-phase task covers;
 * - amount_missing: the first task listing an ingredient (in schedule order
 *   when given, else timeline order) does not state its amount; for divided
 *   ingredients every listing task must state the portion it uses;
 * - batch_round_timing: a batch task timed by one round's quote.
 */
export function runFormatWarnings(
  recipe: CanonicalRecipe,
  timeline: TimelineDefinition,
  schedule?: { tasks: Array<{ id: string; startMinutes: number }> },
): FormatWarning[] {
  const warnings: FormatWarning[] = [];
  const byIngredient = new Map(recipe.ingredients.map((i) => [i.id, i] as const));
  const start = new Map((schedule?.tasks ?? []).map((t) => [t.id, t.startMinutes] as const));
  const order = timeline.tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const sa = start.get(a.task.id);
      const sb = start.get(b.task.id);
      if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
      return a.index - b.index;
    })
    .map((x) => x.task);

  const prepCovered = new Set(
    timeline.tasks.filter((t) => t.phase === "prep").flatMap((t) => t.scheduling.ingredientIds),
  );
  for (const ingredient of recipe.ingredients) {
    const prep = prepNoteOf(ingredient);
    if (prep && !prepCovered.has(ingredient.id)) {
      warnings.push({
        code: "prep_not_covered",
        ingredientId: ingredient.id,
        message: `No prep task covers the ${ingredient.name} (${prep}).`,
      });
    }
  }

  const seen = new Set<string>();
  for (const task of order) {
    const text = normalizeFractions(task.description);
    for (const id of task.scheduling.ingredientIds) {
      const ingredient = byIngredient.get(id);
      if (!ingredient) continue;
      const first = !seen.has(id);
      seen.add(id);
      const quantity = (ingredient.cookQuantity ?? ingredient.quantity).trim();
      if (!quantity || ingredient.scaleRule === "to-taste") continue;
      const divided = isDivided(ingredient);
      if (!first && !divided) continue;
      const ok = divided
        ? ANY_AMOUNT_RE.test(text) || /\b(remaining|rest of|all of|all the)\b/i.test(text)
        : quantityForms(quantity).some((form) => hasForm(text, form));
      if (!ok) {
        warnings.push({
          code: "amount_missing",
          taskId: task.id,
          ingredientId: id,
          message: `"${task.label}" uses the ${ingredient.name} but its description does not say how much (${`${quantity} ${ingredient.unit}`.trim()}).`,
        });
      }
    }
  }

  for (const task of timeline.tasks) {
    const batchy = /\b(batch(?:es)?|rounds?|in two|in three|in 2|in 3)\b/i.test(
      `${task.description} ${task.label}`,
    );
    const perRound = /\b(per|each|a)\s+(side|batch|round)\b/i.test(task.sourceQuote ?? "");
    if (batchy && perRound && task.timingBasis === "source") {
      warnings.push({
        code: "batch_round_timing",
        taskId: task.id,
        message: `"${task.label}" is timed by one round ("${task.sourceQuote}"); it should cover every round.`,
      });
    }
  }
  return warnings;
}
