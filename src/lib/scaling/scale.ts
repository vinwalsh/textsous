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

function roundUp(value: number, unit: string): number {
  if (isCountable(unit)) return Math.ceil(value - 1e-9);
  return Math.ceil(value * 10 - 1e-9) / 10;
}

/**
 * Scale one ingredient by an effective factor. Cook amounts are exact to 2
 * decimals; buy amounts round up (whole items for countable units, 1 decimal
 * otherwise). To-taste and unparseable quantities pass through verbatim.
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
    ? formatAmount(cookLow)
    : `${formatAmount(cookLow)}-${formatAmount(cookHigh)}`;
  const buyLow = roundUp(cookLow, unit);
  const buyHigh = roundUp(cookHigh, unit);
  const buyText = single
    ? formatAmount(buyLow)
    : `${formatAmount(buyLow)}-${formatAmount(buyHigh)}`;
  return {
    cook: { quantity: cookText, unit },
    buy: { quantity: buyText, unit },
    scaled: true,
  };
}
