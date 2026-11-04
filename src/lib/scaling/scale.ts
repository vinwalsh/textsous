import type { CanonicalIngredient, ScaleRule } from "../schema/canonical";
import {
  AMOUNT_SOURCE,
  parseAmount,
  parseAmountToken,
  parseLeadingAmount,
  RANGE_SEPARATOR_SOURCE,
  type ParsedAmount,
} from "./amounts";
import { isCountable, isMeasureUnit, lookupUnit, metricStep } from "./units";

export interface ScaledAmounts {
  cook: { quantity: string; unit: string };
  buy: { quantity: string; unit: string };
  /** False when the quantity was carried through unscaled (to-taste, or no amount to read). */
  scaled: boolean;
}

/** Superlinear amounts never pass this multiple of the linear amount. */
export const SUPERLINEAR_CAP = 1.5;

/** Rule curves: how a servings factor translates to an amount multiplier. */
export function effectiveFactor(rule: ScaleRule, factor: number): number {
  switch (rule) {
    case "linear":
      return factor;
    case "sublinear":
      return Math.sqrt(factor);
    case "flat":
      return 1;
    case "superlinear":
      // factor^1.5 runs away on big batches (2 -> 36 servings would be x76):
      // past x2.25 it holds at half again the linear amount (x18 -> x27).
      return Math.min(factor ** 1.5, factor * SUPERLINEAR_CAP);
    case "to-taste":
      return 1;
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatAmount(value: number): string {
  return String(round2(value));
}

/** Kitchen measuring grid: eighths plus thirds. Ordered low to high. */
const KITCHEN_GRID: Array<{ value: number; text: string }> = [
  { value: 0, text: "" },
  { value: 1 / 8, text: "1/8" },
  { value: 1 / 4, text: "1/4" },
  { value: 1 / 3, text: "1/3" },
  { value: 3 / 8, text: "3/8" },
  { value: 1 / 2, text: "1/2" },
  { value: 5 / 8, text: "5/8" },
  { value: 2 / 3, text: "2/3" },
  { value: 3 / 4, text: "3/4" },
  { value: 7 / 8, text: "7/8" },
  { value: 1, text: "" },
];

function renderKitchen(whole: number, fracText: string): string {
  if (fracText === "") return String(whole);
  return whole === 0 ? fracText : `${whole} ${fracText}`;
}

/**
 * Render a scaled amount the way a cook measures it: nearest kitchen
 * fraction with mixed numbers. Exact ties round down. Positive values too
 * small for the grid show the smallest measure, never "0".
 */
export function formatKitchenAmount(value: number): string {
  if (!(value > 0)) return "0";
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  let best = KITCHEN_GRID[0];
  for (const mark of KITCHEN_GRID) {
    if (Math.abs(frac - mark.value) < Math.abs(frac - best.value) - 1e-9) best = mark;
  }
  if (best.value === 1) return String(whole + 1);
  if (best.value === 0) return whole === 0 ? "1/8" : String(whole);
  return renderKitchen(whole, best.text);
}

/** Round up to the next kitchen fraction, so buy amounts always cover cook. */
export function ceilKitchenAmount(value: number): string {
  if (!(value > 0)) return "0";
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (frac < 1e-9) return String(whole);
  for (const mark of KITCHEN_GRID) {
    if (mark.value > 0 && mark.value >= frac - 1e-9) {
      if (mark.value === 1) return String(whole + 1);
      return renderKitchen(whole, mark.text);
    }
  }
  return String(whole + 1);
}

/** Buy text for a scaled cook value: whole items when countable, else the next kitchen fraction up. */
function buyQuantityText(cookValue: number, unit: string): string {
  if (isCountable(unit)) {
    if (!(cookValue > 0)) return "0";
    return String(Math.ceil(cookValue - 1e-9));
  }
  return ceilKitchenAmount(cookValue);
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * A metric amount on its unit's step (whole g and ml, tenths of kg and l):
 * the nearest step to cook, the next step up to buy. An amount too small
 * for the step keeps a finer one, never "0".
 */
function formatMetricAmount(value: number, step: number, up: boolean): string {
  if (!(value > 0)) return "0";
  // Steps per unit (1 for grams, 10 for kg), multiplied rather than divided
  // so 2.25 kg is 22.5 tenths, not 22.499...
  let per = Math.round(1 / step);
  while (per < 1000 && Math.round(value * per) === 0) per *= 10;
  const steps = up ? Math.ceil(value * per - 1e-9) : Math.round(value * per);
  return trimNumber(steps / per);
}

/** Cook text for a scaled value: metric units to their step, others to kitchen fractions. */
export function formatCookAmount(value: number, unit: string): string {
  const step = metricStep(unit);
  const v = round2(value);
  return step === null ? formatKitchenAmount(v) : formatMetricAmount(v, step, false);
}

/** Buy text for a scaled value: rounded up, to whole items for countable units. */
function formatBuyAmount(value: number, unit: string): string {
  const step = metricStep(unit);
  const v = round2(value);
  return step === null ? buyQuantityText(v, unit) : formatMetricAmount(v, step, true);
}

function scaledAmountText(amount: ParsedAmount, eff: number, unit: string, buy: boolean): string {
  const format = buy ? formatBuyAmount : formatCookAmount;
  const low = format(amount.low * eff, unit);
  return amount.low === amount.high ? low : `${low}-${format(amount.high * eff, unit)}`;
}

/**
 * The unit word after a leading amount ("cup" in "1/2 cup (100g)", "can" in
 * "1 (14.5 oz) can"), else the fallback.
 */
function unitAfter(text: string, fallback: string): string {
  const word = /^\s*(?:\([^()]*\)\s*)?([a-z]+)/i.exec(text)?.[1];
  return word !== undefined && lookupUnit(word) !== null ? word : fallback;
}

/**
 * The amount a quantity scales by, and its unit: the whole quantity in the
 * ingredient's unit ("1 1/2" cups), else its leading amount in the unit word
 * after it ("500" grams in "500 grams or 12 oz"). Null when the quantity
 * holds no amount ("Half a", "a pinch"). Pure.
 */
export function scalableAmount(
  quantity: string,
  unit: string,
): { amount: ParsedAmount; unit: string } | null {
  const whole = parseAmount(quantity);
  if (whole !== null) return { amount: whole, unit };
  const lead = parseLeadingAmount(quantity);
  if (lead === null) return null;
  return { amount: lead.amount, unit: unitAfter(quantity.slice(lead.end), unit) };
}

/** Weights and volumes (and counts) a quantity restates its amount in: "(100g)", "or 12 oz". */
const MEASURE_WORDS = [
  "g", "grams?", "grammes?", "gr", "kgs?", "kilograms?", "kilos?",
  "ml", "millilit(?:er|re)s?", "l", "lit(?:er|re)s?",
  "fl\\.?\\s*oz", "oz", "ounces?", "lbs?", "pounds?",
  "cups?", "c", "tbsps?", "tbs", "tablespoons?", "tsps?", "teaspoons?",
  "pints?", "quarts?", "qts?", "sticks?", "cloves?", "large", "medium", "small",
].join("|");

/** Package words: a size next to one is the package's, not the amount ("15 oz can"). */
const CONTAINER_WORDS =
  "cans?|jars?|packages?|pkgs?|packets?|box(?:es)?|bags?|bottles?|cartons?|tins?|containers?|pouch(?:es)?|tubs?|blocks?";

const MEASURE_RE = new RegExp(
  `(?<![\\w./⁄])(${AMOUNT_SOURCE})(?:(${RANGE_SEPARATOR_SOURCE})(${AMOUNT_SOURCE}))?(\\s*[-–]?\\s*)(${MEASURE_WORDS})(?![a-z])`,
  "gi",
);
const CONTAINER_NEXT = new RegExp(`^\\s*\\)?\\s*(?:${CONTAINER_WORDS})\\b`, "i");
const CONTAINER_BEFORE = new RegExp(`\\b(?:${CONTAINER_WORDS})\\.?\\s*$`, "i");

/**
 * Parentheticals that give a package size: "(24-ounce)" or "(14.5 oz)"
 * right after a count, or next to a package word ("1 can (15 oz)",
 * "(14.5 oz) can"). After a measure ("1/2 cup (100g)") a parenthetical is
 * the same amount in other units.
 */
function packageSpans(rest: string, countFirst: boolean): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of rest.matchAll(/\([^()]*\)/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = rest.slice(0, start);
    if (
      (countFirst && before.trim() === "") ||
      CONTAINER_BEFORE.test(before) ||
      CONTAINER_NEXT.test(rest.slice(end))
    ) {
      spans.push([start, end]);
    }
  }
  return spans;
}

/**
 * Scale the other measures of the same amount in the text after a leading
 * amount: "(100g)", "(8 Tbsp; 113g)", "or 12 oz", "plus 2 tbsp". Package
 * sizes stay: hyphenated sizes ("24-ounce"), sizes in a parenthetical right
 * after a count, and sizes next to a package word.
 */
function scaleRestatedAmounts(rest: string, eff: number, countFirst: boolean): string {
  const spans = packageSpans(rest, countFirst);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const match of rest.matchAll(MEASURE_RE)) {
    const [whole, lowText, separator, highText, gap, unit] = match;
    const start = match.index;
    const end = start + whole.length;
    if (highText === undefined && /[-–]/.test(gap)) continue;
    if (spans.some(([from, to]) => start >= from && end <= to)) continue;
    if (CONTAINER_NEXT.test(rest.slice(end))) continue;
    const low = parseAmountToken(lowText);
    if (low === null) continue;
    edits.push({ start, end: start + lowText.length, text: formatCookAmount(low * eff, unit) });
    if (highText !== undefined) {
      const high = parseAmountToken(highText);
      const highStart = start + lowText.length + separator.length;
      if (high === null || high < low) {
        edits.pop();
        continue;
      }
      edits.push({
        start: highStart,
        end: highStart + highText.length,
        text: formatCookAmount(high * eff, unit),
      });
    }
  }
  let out = rest;
  for (const edit of edits.reverse()) {
    out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  }
  return out;
}

/**
 * Scale one ingredient by an effective factor. Cook amounts render as kitchen
 * fractions (metric weights and volumes as whole g and ml, tenths of kg and
 * l); buy amounts round up (whole items for countable units, next kitchen
 * fraction or metric step otherwise). A quantity that is more than an amount
 * ("1/2 cup (100g)", "500 grams or 12 oz", "1 (24-ounce)") scales its
 * leading amount and the other measures of the same amount, never a package
 * size. To-taste quantities and quantities with no amount ("Half a", "a
 * pinch") pass through verbatim.
 */
export function scaleIngredient(
  ingredient: CanonicalIngredient,
  factor: number,
): ScaledAmounts {
  const rule = ingredient.scaleRule ?? "linear";
  const unit = ingredient.unit;
  const verbatim: ScaledAmounts = {
    cook: { quantity: ingredient.quantity, unit },
    buy: { quantity: ingredient.quantity, unit },
    scaled: false,
  };
  if (rule === "to-taste") return verbatim;
  const eff = effectiveFactor(rule, factor);
  const parsed = parseAmount(ingredient.quantity);
  if (parsed !== null) {
    return {
      cook: { quantity: scaledAmountText(parsed, eff, unit, false), unit },
      buy: { quantity: scaledAmountText(parsed, eff, unit, true), unit },
      scaled: true,
    };
  }
  const text = ingredient.quantity;
  const lead = parseLeadingAmount(text);
  if (lead === null) return verbatim;
  const head = text.slice(0, lead.start);
  const after = text.slice(lead.end);
  const leadUnit = unitAfter(after, unit);
  // A parenthetical right after a count is a package size ("1 (24-ounce)" jar);
  // after an amount in a measure ("1/2 (100g)" cup) it restates the amount.
  const rest = scaleRestatedAmounts(after, eff, !isMeasureUnit(leadUnit));
  return {
    cook: { quantity: `${head}${scaledAmountText(lead.amount, eff, leadUnit, false)}${rest}`, unit },
    buy: { quantity: `${head}${scaledAmountText(lead.amount, eff, leadUnit, true)}${rest}`, unit },
    scaled: true,
  };
}
