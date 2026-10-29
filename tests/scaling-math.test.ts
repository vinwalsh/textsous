import { describe, expect, it } from "vitest";
import type { CanonicalIngredient, ScaleRule } from "../src/lib/schema/canonical";
import { effectiveFactor, scaleIngredient } from "../src/lib/scaling/scale";

function ingredient(overrides: Partial<CanonicalIngredient> = {}): CanonicalIngredient {
  return {
    id: "ing-1",
    name: "stock",
    quantity: "2",
    unit: "cup",
    quantity4: null,
    scaleRule: null,
    allergens: [],
    allergenTraces: [],
    note: null,
    cookQuantity: null,
    buyQuantity: null,
    ...overrides,
  };
}

describe("effectiveFactor", () => {
  const cases: Array<[ScaleRule, number, number]> = [
    ["linear", 3, 3],
    ["sublinear", 4, 2],
    ["flat", 4, 1],
    ["superlinear", 4, 8],
    ["to-taste", 4, 1],
  ];
  for (const [rule, factor, expected] of cases) {
    it(`${rule} at ×${factor} is ×${expected}`, () => {
      expect(effectiveFactor(rule, factor)).toBeCloseTo(expected, 9);
    });
  }
});

describe("scaleIngredient", () => {
  it("scales linearly with cook and buy amounts", () => {
    const scaled = scaleIngredient(
      ingredient({ quantity: "1 1/2", unit: "cup", scaleRule: "linear" }),
      2,
    );
    expect(scaled.scaled).toBe(true);
    expect(scaled.cook).toEqual({ quantity: "3", unit: "cup" });
    expect(scaled.buy).toEqual({ quantity: "3", unit: "cup" });
  });

  it("applies sublinear and superlinear curves", () => {
    expect(
      scaleIngredient(ingredient({ quantity: "2", unit: "tsp", scaleRule: "sublinear" }), 4).cook,
    ).toEqual({ quantity: "4", unit: "tsp" });
    expect(
      scaleIngredient(ingredient({ quantity: "1", unit: "cup", scaleRule: "superlinear" }), 4).cook,
    ).toEqual({ quantity: "8", unit: "cup" });
  });

  it("keeps flat quantities unchanged", () => {
    const scaled = scaleIngredient(
      ingredient({ quantity: "1", unit: "tbsp", scaleRule: "flat" }),
      3,
    );
    expect(scaled.scaled).toBe(true);
    expect(scaled.cook).toEqual({ quantity: "1", unit: "tbsp" });
  });

  it("carries to-taste and unparseable quantities through verbatim", () => {
    const toTaste = scaleIngredient(
      ingredient({ quantity: "", unit: "", scaleRule: "to-taste" }),
      4,
    );
    expect(toTaste).toEqual({
      cook: { quantity: "", unit: "" },
      buy: { quantity: "", unit: "" },
      scaled: false,
    });
    const vague = scaleIngredient(ingredient({ quantity: "a handful", scaleRule: "linear" }), 2);
    expect(vague.scaled).toBe(false);
    expect(vague.cook.quantity).toBe("a handful");
  });

  it("scales both ends of a range", () => {
    const scaled = scaleIngredient(
      ingredient({ quantity: "2-3", unit: "cup", scaleRule: "linear" }),
      2,
    );
    expect(scaled.cook).toEqual({ quantity: "4-6", unit: "cup" });
  });

  it("rounds buy amounts up: whole items for countable units", () => {
    const slices = scaleIngredient(
      ingredient({ quantity: "2", unit: "slices", scaleRule: "linear" }),
      1.2,
    );
    expect(slices.cook).toEqual({ quantity: "2.4", unit: "slices" });
    expect(slices.buy).toEqual({ quantity: "3", unit: "slices" });
    const cups = scaleIngredient(
      ingredient({ quantity: "1", unit: "cup", scaleRule: "linear" }),
      1.15,
    );
    expect(cups.cook).toEqual({ quantity: "1.15", unit: "cup" });
    expect(cups.buy).toEqual({ quantity: "1.2", unit: "cup" });
  });

  it("defaults a missing rule to linear", () => {
    const scaled = scaleIngredient(ingredient({ quantity: "2", scaleRule: null }), 3);
    expect(scaled.cook.quantity).toBe("6");
  });
});
