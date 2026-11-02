import type { CanonicalIngredient, ScaleRule } from "../schema/canonical";
import { parseAmount } from "./amounts";
import { isCountable } from "./units";

export interface ScaledAmounts {
  cook: { quantity: string; unit: string };
  buy: { quantity: string; unit: string };
  /** False when the quantity was carried through unscaled (to-taste or unparseable). */
  scaled: boolean;
}

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
      return factor ** 1.5;
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

/**
 * Scale one ingredient by an effective factor. Cook amounts render as kitchen
 * fractions; buy amounts round up (whole items for countable units, next
 * kitchen fraction otherwise). To-taste and unparseable quantities pass
 * through verbatim.
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
  const parsed = parseAmount(ingredient.quantity);
  if (parsed === null) return verbatim;
  const eff = effectiveFactor(rule, factor);
  const cookLow = Math.round(parsed.low * eff * 100) / 100;
  const cookHigh = Math.round(parsed.high * eff * 100) / 100;
  const single = parsed.low === parsed.high;
  const cookText = single
    ? formatKitchenAmount(cookLow)
    : `${formatKitchenAmount(cookLow)}-${formatKitchenAmount(cookHigh)}`;
  const buyText = single
    ? buyQuantityText(cookLow, unit)
    : `${buyQuantityText(cookLow, unit)}-${buyQuantityText(cookHigh, unit)}`;
  return {
    cook: { quantity: cookText, unit },
    buy: { quantity: buyText, unit },
    scaled: true,
  };
}
