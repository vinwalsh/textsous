import { describe, expect, it } from "vitest";
import type { CanonicalIngredient, ScaleRule } from "../src/lib/schema/canonical";
import {
  ceilKitchenAmount,
  effectiveFactor,
  formatKitchenAmount,
  scaleIngredient,
} from "../src/lib/scaling/scale";

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
    ["superlinear", 2, 2 ** 1.5],
    ["superlinear", 2.25, 3.375],
    ["superlinear", 4, 6],
    ["superlinear", 18, 27],
    ["superlinear", 0.5, 0.5 ** 1.5],
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
      scaleIngredient(ingredient({ quantity: "1", unit: "cup", scaleRule: "superlinear" }), 2).cook,
    ).toEqual({ quantity: "2 7/8", unit: "cup" });
    expect(
      scaleIngredient(ingredient({ quantity: "1", unit: "cup", scaleRule: "superlinear" }), 4).cook,
    ).toEqual({ quantity: "6", unit: "cup" });
  });

  it("keeps big batches sensible: x18 is x18 linear, x4 1/4 sublinear, x27 superlinear", () => {
    const at18 = (rule: ScaleRule) =>
      scaleIngredient(ingredient({ quantity: "1", unit: "cup", scaleRule: rule }), 18).cook.quantity;
    expect(at18("linear")).toBe("18");
    expect(at18("sublinear")).toBe("4 1/4");
    expect(at18("superlinear")).toBe("27");
    expect(at18("flat")).toBe("1");
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
    expect(slices.cook).toEqual({ quantity: "2 3/8", unit: "slices" });
    expect(slices.buy).toEqual({ quantity: "3", unit: "slices" });
    const cups = scaleIngredient(
      ingredient({ quantity: "1", unit: "cup", scaleRule: "linear" }),
      1.15,
    );
    expect(cups.cook).toEqual({ quantity: "1 1/8", unit: "cup" });
    expect(cups.buy).toEqual({ quantity: "1 1/4", unit: "cup" });
  });

  it("defaults a missing rule to linear", () => {
    const scaled = scaleIngredient(ingredient({ quantity: "2", scaleRule: null }), 3);
    expect(scaled.cook.quantity).toBe("6");
  });
});

describe("formatKitchenAmount", () => {
  const cases: Array<[number, string]> = [
    [2, "2"],
    [0.5, "1/2"],
    [1.5, "1 1/2"],
    [0.33, "1/3"],
    [0.66, "2/3"],
    [2.4, "2 3/8"],
    [1.15, "1 1/8"],
    [2.67, "2 2/3"],
    [3.75, "3 3/4"],
    [0.99, "1"],
    [0.02, "1/8"],
    [0.5625, "1/2"],
    [0, "0"],
  ];
  for (const [value, expected] of cases) {
    it(`${value} renders as ${expected}`, () => {
      expect(formatKitchenAmount(value)).toBe(expected);
    });
  }
});

describe("ceilKitchenAmount", () => {
  const cases: Array<[number, string]> = [
    [2, "2"],
    [0.5, "1/2"],
    [1.2, "1 1/4"],
    [0.34, "3/8"],
    [0.99, "1"],
    [0.02, "1/8"],
    [0, "0"],
  ];
  for (const [value, expected] of cases) {
    it(`${value} rounds up to ${expected}`, () => {
      expect(ceilKitchenAmount(value)).toBe(expected);
    });
  }
});
