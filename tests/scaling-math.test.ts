import { describe, expect, it } from "vitest";
import type { CanonicalIngredient, ScaleRule } from "../src/lib/schema/canonical";
import {
  ceilKitchenAmount,
  effectiveFactor,
  formatKitchenAmount,
  roundWholeItems,
  scaleIngredient,
} from "../src/lib/scaling/scale";
import { isWholeItem } from "../src/lib/scaling/units";

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
    // Containers are used in parts: kitchen fractions to cook, whole to buy.
    const cans = scaleIngredient(
      ingredient({ quantity: "2", unit: "cans", scaleRule: "linear" }),
      1.2,
    );
    expect(cans.cook).toEqual({ quantity: "2 3/8", unit: "cans" });
    expect(cans.buy).toEqual({ quantity: "3", unit: "cans" });
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

describe("whole items", () => {
  const at = (quantity: string, unit: string, factor: number) => {
    const scaled = scaleIngredient(ingredient({ quantity, unit, scaleRule: "linear" }), factor);
    return [scaled.cook.quantity, scaled.buy.quantity];
  };

  it("counts no unit, size words and item units as whole items, never measures or containers", () => {
    for (const unit of ["", "large", "Medium", "cloves", "slices", "each", "leaves", "cubes", "sprigs", "head", "bunches", "breasts"]) {
      expect(isWholeItem(unit), unit).toBe(true);
    }
    for (const unit of ["cup", "tsp", "g", "ml", "oz", "lb.", "cans", "jar", "sticks", "pinch", "c.", "furlongs"]) {
      expect(isWholeItem(unit), unit).toBe(false);
    }
  });

  it("rounds to the nearest half below 2 and the nearest whole from 2, never under 1/2", () => {
    const cases: Array<[number, number]> = [
      [0.1, 0.5], [0.6, 0.5], [0.75, 1], [1.2, 1], [1.3, 1.5], [1.8, 2], [2.4, 2], [2.5, 3], [4.6, 5],
    ];
    for (const [value, expected] of cases) expect(roundWholeItems(value), String(value)).toBe(expected);
  });

  it("5 -> 3 servings (x0.6): cook in halves and wholes, buy whole", () => {
    expect(at("2", "", 0.6)).toEqual(["1", "1"]); // 2 dried bay leaves
    expect(at("2", "cubes", 0.6)).toEqual(["1", "1"]); // 2 beef bouillon cubes
    expect(at("1", "", 0.6)).toEqual(["1/2", "1"]); // 1 onion
    expect(at("3", "", 0.6)).toEqual(["2", "2"]); // 3 eggs
    expect(at("3", "cloves", 0.6)).toEqual(["2", "2"]);
    expect(at("2-3", "", 0.6)).toEqual(["1-2", "1-2"]);
    expect(at("2 large", "", 0.6)).toEqual(["1 large", "1 large"]);
  });

  it("x1.5: 2 large eggs are 3", () => {
    expect(at("2", "large", 1.5)).toEqual(["3", "3"]);
  });

  it("leaves measured units as they were", () => {
    expect(at("1", "cup", 0.6)).toEqual(["5/8", "5/8"]);
    expect(at("2", "tsp", 0.6)).toEqual(["1 1/4", "1 1/4"]);
    expect(at("300", "g", 0.6)).toEqual(["180", "180"]);
    expect(at("1 1/2", "lb", 0.6)).toEqual(["7/8", "1"]);
  });

  it("keeps the exact amount for an item printed in parts, still bought whole", () => {
    expect(at("1/4", "", 1.25)).toEqual(["1/3", "1"]); // 1/4 red onion
    expect(at("1/4", "", 1)).toEqual(["1/4", "1"]);
  });

  it("rounds a restated count the same way, and a restated measure not at all", () => {
    expect(at("1 head (10 cloves)", "", 0.55)).toEqual(["1/2 head (6 cloves)", "1 head (6 cloves)"]);
    expect(at("1/2 cup (100g)", "", 0.7)).toEqual(["1/3 cup (70g)", "3/8 cup (70g)"]);
  });
});
