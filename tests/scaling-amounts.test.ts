import { describe, expect, it } from "vitest";
import {
  extractNumericTokens,
  extractTimingNumbers,
  findNumbers,
  parseAmount,
  type ParsedAmount,
} from "../src/lib/scaling/amounts";
import { isCountable, lookupUnit } from "../src/lib/scaling/units";

const AMOUNT_CASES: Array<[string, ParsedAmount | null]> = [
  ["1", { low: 1, high: 1 }],
  ["2", { low: 2, high: 2 }],
  ["0", { low: 0, high: 0 }],
  ["2.5", { low: 2.5, high: 2.5 }],
  [".5", { low: 0.5, high: 0.5 }],
  ["1/2", { low: 0.5, high: 0.5 }],
  ["3/2", { low: 1.5, high: 1.5 }],
  ["1 1/2", { low: 1.5, high: 1.5 }],
  ["½", { low: 0.5, high: 0.5 }],
  ["¼", { low: 0.25, high: 0.25 }],
  ["1½", { low: 1.5, high: 1.5 }],
  ["1 ½", { low: 1.5, high: 1.5 }],
  ["2-3", { low: 2, high: 3 }],
  ["2–3", { low: 2, high: 3 }],
  ["2 - 3", { low: 2, high: 3 }],
  ["1 to 2", { low: 1, high: 2 }],
  ["1,000", { low: 1000, high: 1000 }],
  ["  2  ", { low: 2, high: 2 }],
  ["", null],
  ["   ", null],
  ["to taste", null],
  ["a few", null],
  ["1/0", null],
  ["3-2", null],
  ["1-2-3", null],
  ["15-oz", null],
  ["abc", null],
];

describe("parseAmount", () => {
  for (const [input, expected] of AMOUNT_CASES) {
    it(`parses ${JSON.stringify(input)}`, () => {
      const parsed = parseAmount(input);
      if (expected === null) {
        expect(parsed).toBeNull();
      } else {
        expect(parsed?.low).toBeCloseTo(expected.low, 9);
        expect(parsed?.high).toBeCloseTo(expected.high, 9);
      }
    });
  }
});

const UNIT_CASES: Array<[string, { standard: string; kind: string } | null]> = [
  ["cups", { standard: "cup", kind: "volume" }],
  ["Cups", { standard: "cup", kind: "volume" }],
  ["tbsp.", { standard: "tbsp", kind: "volume" }],
  ["Teaspoons", { standard: "tsp", kind: "volume" }],
  ["ml", { standard: "ml", kind: "volume" }],
  ["g", { standard: "g", kind: "weight" }],
  ["Ounces", { standard: "oz", kind: "weight" }],
  ["lb", { standard: "lb", kind: "weight" }],
  ["cloves", { standard: "clove", kind: "count" }],
  ["slices", { standard: "slice", kind: "count" }],
  ["pinch", { standard: "pinch", kind: "other" }],
  ["furlongs", null],
  ["", null],
];

describe("unit table", () => {
  for (const [input, expected] of UNIT_CASES) {
    it(`looks up ${JSON.stringify(input)}`, () => {
      expect(lookupUnit(input)).toEqual(expected);
    });
  }

  it("detects countable units", () => {
    expect(isCountable("slices")).toBe(true);
    expect(isCountable("cans")).toBe(true);
    expect(isCountable("cups")).toBe(false);
    expect(isCountable("furlongs")).toBe(false);
  });
});

describe("number extraction", () => {
  it("finds tokens with offsets, keeping mixed numbers whole", () => {
    const found = findNumbers("Add 1 1/2 cups and simmer 2-3 minutes");
    expect(found.map((n) => n.token)).toEqual(["1 1/2", "2", "3"]);
    expect(found[0]).toMatchObject({ value: 1.5, start: 4, end: 9 });
    expect(found[1]).toMatchObject({ value: 2 });
    expect("Add 1 1/2 cups".slice(found[0].start, found[0].end)).toBe("1 1/2");
  });

  it("extracts raw tokens in order", () => {
    expect(extractNumericTokens("½ onion, 2 cups, 1/4 tsp")).toEqual(["½", "2", "1/4"]);
  });

  it("extracts timing numbers sorted", () => {
    expect(extractTimingNumbers("rest 1 hour, then simmer 20 minutes")).toEqual([1, 20]);
    expect(extractTimingNumbers("2 cups flour")).toEqual([]);
  });
});
