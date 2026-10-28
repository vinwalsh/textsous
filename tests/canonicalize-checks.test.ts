import { describe, expect, it } from "vitest";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import {
  injectedSectionLabels,
  parseServings,
  runCanonicalChecks,
  stripInjectedSectionLabels,
  type CanonicalizeInput,
} from "../src/lib/stages/canonicalize";

function makeInput(overrides: Partial<CanonicalizeInput> = {}): CanonicalizeInput {
  return {
    source: { kind: "url", url: "https://example.com/r", site: "Example", author: "A" },
    title: "Example",
    ingredientLines: ["1 cup rolled oats", "2 cups whole milk"],
    instructionLines: ["Cook the oats in the milk."],
    servingsRaw: "2 servings",
    rawText: "Example 1 cup rolled oats 2 cups whole milk. Cook the oats in the milk.",
    hasJsonLd: true,
    ...overrides,
  };
}

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  const base: CanonicalRecipe = {
    version: 1,
    id: "rcp-test",
    title: "Example",
    source: {
      kind: "url",
      url: "https://example.com/r",
      site: "Example",
      author: "A",
      book: null,
      page: null,
      license: null,
    },
    cuisine: null,
    nativeServings: 2,
    servingsLarge: null,
    scalingNotes: null,
    ingredients: [
      {
        id: "ing-1",
        name: "rolled oats",
        quantity: "1",
        unit: "cup",
        quantity4: null,
        scaleRule: null,
        allergens: ["gluten"],
        allergenTraces: [],
        note: null,
      },
      {
        id: "ing-2",
        name: "whole milk",
        quantity: "2",
        unit: "cups",
        quantity4: null,
        scaleRule: null,
        allergens: ["milk"],
        allergenTraces: [],
        note: null,
      },
    ],
    steps: [{ id: "step-1", kind: "active", text: "Cook the oats in the milk." }],
    equipment: [],
    sourceFingerprint: "sha256:test",
  };
  return { ...base, ...overrides };
}

function passed(checks: { name: string; passed: boolean }[], name: string): boolean {
  return checks.find((c) => c.name === name)?.passed ?? false;
}

describe("stripInjectedSectionLabels", () => {
  it("collects injected labels and strips only those", () => {
    const labels = injectedSectionLabels(["[Apples] Melt the butter.", "Serve warm."]);
    expect(labels).toEqual(["Apples"]);
    expect(stripInjectedSectionLabels("[Apples] Melt the butter.", labels)).toBe(
      "Melt the butter.",
    );
    expect(stripInjectedSectionLabels("Serve warm.", labels)).toBe("Serve warm.");
  });

  it("leaves genuine source brackets untouched", () => {
    expect(stripInjectedSectionLabels("[optional] nuts on top.", ["Apples"])).toBe(
      "[optional] nuts on top.",
    );
    expect(stripInjectedSectionLabels("[Apples] Serve.", [])).toBe("[Apples] Serve.");
  });
});

describe("parseServings", () => {
  it("parses single and range servings", () => {
    expect(parseServings("2 servings")).toEqual({ low: 2, high: undefined });
    expect(parseServings("4-6")).toEqual({ low: 4, high: 6 });
    expect(parseServings("Makes about 12")).toEqual({ low: 12, high: undefined });
    expect(parseServings("Serves 4 to 6")).toEqual({ low: 4, high: 6 });
  });

  it("returns null when no number is present", () => {
    expect(parseServings("n/a")).toBeNull();
  });
});

describe("runCanonicalChecks", () => {
  it("passes when the recipe matches the source", () => {
    const checks = runCanonicalChecks(makeInput(), makeRecipe());
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails ingredient_count on mismatch", () => {
    const recipe = makeRecipe({ ingredients: makeRecipe().ingredients.slice(0, 1) });
    expect(passed(runCanonicalChecks(makeInput(), recipe), "ingredient_count")).toBe(false);
  });

  it("fails servings on mismatch and accepts ranges", () => {
    expect(passed(runCanonicalChecks(makeInput(), makeRecipe({ nativeServings: 8 })), "servings")).toBe(
      false,
    );
    const range = makeInput({ servingsRaw: "4-6" });
    expect(
      passed(
        runCanonicalChecks(range, makeRecipe({ nativeServings: 4, servingsLarge: 6 })),
        "servings",
      ),
    ).toBe(true);
  });

  it("fails ingredient_names when the model invents an ingredient", () => {
    const recipe = makeRecipe();
    recipe.ingredients = [
      ...recipe.ingredients,
      {
        id: "ing-3",
        name: "truffle oil",
        quantity: "1",
        unit: "tsp",
        quantity4: null,
        scaleRule: null,
        allergens: [],
        allergenTraces: [],
        note: null,
      },
    ];
    const checks = runCanonicalChecks(makeInput(), recipe);
    expect(passed(checks, "ingredient_names")).toBe(false);
  });

  it("skips count and servings checks without JSON-LD", () => {
    const input = makeInput({ hasJsonLd: false, ingredientLines: [], servingsRaw: undefined });
    const checks = runCanonicalChecks(input, makeRecipe());
    expect(passed(checks, "ingredient_count")).toBe(true);
    expect(passed(checks, "servings")).toBe(true);
  });
});
