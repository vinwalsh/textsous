import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { CanonicalIngredient } from "../src/lib/schema/canonical";
import type { StructuredChatClient } from "../src/lib/model/structured";
import { parseLeadingAmount } from "../src/lib/scaling/amounts";
import { scaleIngredient } from "../src/lib/scaling/scale";
import { rescaleText } from "../src/lib/scaling/text";
import { formatQuantityWithUnit } from "../src/lib/scaling/units";
import { applyScaling, type ScaleRuleAssignment } from "../src/lib/stages/scaling";
import { adjustArtifact } from "../src/lib/pipeline";
import { adjustNotices } from "../src/app/AdjustPanel";
import { IngredientsCard } from "../src/app/ArtifactViewer";

function ingredient(quantity: string, unit: string, overrides: Partial<CanonicalIngredient> = {}): CanonicalIngredient {
  return {
    id: "ing-1",
    name: "flour",
    quantity,
    unit,
    quantity4: null,
    scaleRule: "linear",
    allergens: [],
    allergenTraces: [],
    note: null,
    cookQuantity: null,
    buyQuantity: null,
    ...overrides,
  };
}

/** 12 muffins -> 18 is x1.5. */
function at18(quantity: string, unit: string) {
  return scaleIngredient(ingredient(quantity, unit), 18 / 12);
}

describe("parseLeadingAmount", () => {
  it("reads the amount a longer quantity starts with", () => {
    expect(parseLeadingAmount("1 and 3/4 cups (219g)")).toEqual({ amount: { low: 1.75, high: 1.75 }, start: 0, end: 9 });
    expect(parseLeadingAmount("1 & 3/4 cups")?.amount).toEqual({ low: 1.75, high: 1.75 });
    expect(parseLeadingAmount("1/2 cup (100g)")?.amount).toEqual({ low: 0.5, high: 0.5 });
    expect(parseLeadingAmount("1 ½ cups")?.amount).toEqual({ low: 1.5, high: 1.5 });
    expect(parseLeadingAmount("2.5 cups")?.amount).toEqual({ low: 2.5, high: 2.5 });
    expect(parseLeadingAmount("2 to 3 cups")?.amount).toEqual({ low: 2, high: 3 });
    expect(parseLeadingAmount("2-3 large")?.amount).toEqual({ low: 2, high: 3 });
    expect(parseLeadingAmount("1 (24-ounce)")).toEqual({ amount: { low: 1, high: 1 }, start: 0, end: 1 });
    expect(parseLeadingAmount("about 2 cups")).toEqual({ amount: { low: 2, high: 2 }, start: 6, end: 7 });
  });

  it("finds no amount in words or in a size", () => {
    for (const text of ["Half a", "A fistful", "Many grinds of", "a pinch", "", "1-inch piece", "15-ounce can", "3-2 cups"]) {
      expect(parseLeadingAmount(text)).toBeNull();
    }
  });
});

describe("scaleIngredient with free-text quantities, 12 -> 18 muffins", () => {
  it("scales the leading amount and the grams in parentheses", () => {
    expect(at18("1/2 cup (100g)", "cup").cook).toEqual({ quantity: "3/4 cup (150g)", unit: "cup" });
    // 1 3/4 x 1.5 = 2 5/8 cups; 219 x 1.5 = 328.5 g.
    const flour = at18("1 and 3/4 cups (219g)", "cups");
    expect(flour.scaled).toBe(true);
    expect(flour.cook.quantity).toBe("2 5/8 cups (329g)");
    expect(flour.buy.quantity).toBe("2 2/3 cups (329g)");
    expect(at18("1/2 cup (8 Tbsp; 113g)", "cup").cook.quantity).toBe("3/4 cup (12 Tbsp; 170g)");
    expect(at18("1/4 cup (60ml)", "cup").cook.quantity).toBe("3/8 cup (90ml)");
    expect(at18("1 & 3/4 cups", "").cook.quantity).toBe("2 5/8 cups");
  });

  it("keeps whole-number quantities as before", () => {
    expect(at18("1", "teaspoon").cook.quantity).toBe("1 1/2");
    expect(at18("1 ½", "cups").cook.quantity).toBe("2 1/4");
  });

  it("scales both sides of an 'or' equivalent", () => {
    expect(at18("500 grams or 12 oz", "").cook.quantity).toBe("750 grams or 18 oz");
    expect(at18("235 ml or 1 cup", "ml").cook.quantity).toBe("353 ml or 1 1/2 cup");
  });

  it("scales both ends of a range, in the lead and in parentheses", () => {
    expect(at18("2 to 3 cups (480-720ml)", "").cook.quantity).toBe("3-4 1/2 cups (720-1080ml)");
  });

  it("never scales a package size", () => {
    const jar = at18("1 (24-ounce)", "jar");
    expect(jar.cook).toEqual({ quantity: "1 1/2 (24-ounce)", unit: "jar" });
    expect(jar.buy).toEqual({ quantity: "2 (24-ounce)", unit: "jar" });
    const can = at18("1 (14.5 oz) can", "");
    expect(can.cook.quantity).toBe("1 1/2 (14.5 oz) can");
    expect(can.buy.quantity).toBe("2 (14.5 oz) can");
    expect(at18("2 15-ounce cans", "").cook.quantity).toBe("3 15-ounce cans");
    expect(at18("1 can (15 oz)", "").cook.quantity).toBe("1 1/2 can (15 oz)");
    // A measure restated in parentheses is the same amount, not a package.
    expect(at18("1 stick (1/2 cup; 113g)", "").cook.quantity).toBe("1 1/2 stick (3/4 cup; 170g)");
  });

  it("rounds metric amounts: whole grams and ml, tenths of kg and l", () => {
    expect(at18("125", "g").cook.quantity).toBe("188");
    expect(at18("125", "grams").buy.quantity).toBe("188");
    expect(at18("1.5", "kg").cook.quantity).toBe("2.3");
    expect(at18("1.25", "litres").cook.quantity).toBe("1.9");
    // Buy rounds up to the next step.
    const kg = at18("1.02", "kg");
    expect(kg.cook.quantity).toBe("1.5");
    expect(kg.buy.quantity).toBe("1.6");
    // Too small for whole grams: a finer step, never "0".
    expect(at18("0.2", "g").cook.quantity).toBe("0.3");
  });

  it("leaves words-only amounts and sizes verbatim", () => {
    for (const quantity of ["Half a", "A fistful", "Many grinds of", "a pinch", "1-inch piece"]) {
      const scaled = at18(quantity, "");
      expect(scaled).toEqual({
        cook: { quantity, unit: "" },
        buy: { quantity, unit: "" },
        scaled: false,
      });
    }
  });
});

describe("rescaleText with metric amounts", () => {
  it("rounds a rescaled gram amount in step text like the ingredient list", () => {
    const out = rescaleText("Add 125 g butter.", [{ current: 125, next: 187.5, unit: "g", name: "butter" }]);
    expect(out.text).toBe("Add 188 g butter.");
  });
});

function muffinIngredient(id: string, name: string, quantity: string, unit: string): CanonicalIngredient {
  return ingredient(quantity, unit, { id, name, scaleRule: null });
}

function makeMuffins(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-muffins",
    recipe: {
      title: "Muffins",
      servings: 12,
      ingredients: [
        muffinIngredient("ing-1", "light or dark brown sugar", "1/2 cup (100g)", "cup"),
        muffinIngredient("ing-2", "all-purpose flour", "1 and 3/4 cups (219g)", "cups"),
        muffinIngredient("ing-3", "unsalted butter", "1/2 cup (8 Tbsp; 113g)", "cup"),
        muffinIngredient("ing-4", "milk", "1/4 cup (60ml)", "cup"),
        muffinIngredient("ing-5", "baking soda", "1", "teaspoon"),
        muffinIngredient("ing-6", "red onion", "Half a", ""),
        muffinIngredient("ing-7", "fresh herbs", "A fistful", ""),
        muffinIngredient("ing-8", "black pepper", "Many grinds of", ""),
        muffinIngredient("ing-9", "salt", "", ""),
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Whisk 1/2 cup brown sugar into 1/4 cup milk." }],
      allergens: [],
      originalMethod: "bake",
      methodLabel: "Baked",
      methodNotice: "",
      credit: { kind: "text", site: null, author: null, url: null, book: null, page: null, license: null },
    },
    timelineDefinition: { lanes: [], tasks: [], resources: [], resourceHolds: [], serveTaskId: "task-1" },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

const MUFFIN_RULES: ScaleRuleAssignment[] = [
  ...["ing-1", "ing-2", "ing-3", "ing-4", "ing-5", "ing-6", "ing-7", "ing-8"].map((ingredientId) => ({
    ingredientId,
    rule: "linear" as const,
    reason: "batter",
  })),
  { ingredientId: "ing-9", rule: "to-taste", reason: "table" },
];

const CHECK_NOTE = "Check these amounts; they were not rescaled: red onion, fresh herbs, black pepper.";

describe("applyScaling 12 -> 18 muffins", () => {
  it("rescales free-text quantities and their amounts in steps", () => {
    const { artifact, flags } = applyScaling(makeMuffins(), 18, MUFFIN_RULES);
    expect(artifact.recipe.ingredients.map((i) => i.cookQuantity)).toEqual([
      "3/4 cup (150g)",
      "2 5/8 cups (329g)",
      "3/4 cup (12 Tbsp; 170g)",
      "3/8 cup (90ml)",
      "1 1/2",
      "Half a",
      "A fistful",
      "Many grinds of",
      "",
    ]);
    expect(artifact.recipe.steps[0].text).toBe("Whisk 3/4 cup brown sugar into 3/8 cup milk.");
    expect(flags).toEqual([]);
  });

  it("names the ingredients it could not rescale, once, in the artifact", () => {
    const result = applyScaling(makeMuffins(), 18, MUFFIN_RULES);
    expect(result.unscaled).toEqual(["red onion", "fresh herbs", "black pepper"]);
    expect(result.artifact.changes.map((c) => c.detail)).toEqual([
      "rescaled 12 → 18 servings (×1.5)",
      CHECK_NOTE,
    ]);
    // Back at the printed servings nothing changed, so nothing to check.
    const back = applyScaling(result.artifact, 12, MUFFIN_RULES);
    expect(back.unscaled).toEqual([]);
    expect(back.artifact.recipe.ingredients[1].cookQuantity).toBe("1 3/4 cups (219g)");
  });

  it("rescales from the printed amounts: 12 -> 18 -> 24 equals 12 -> 24", () => {
    const direct = applyScaling(makeMuffins(), 24, MUFFIN_RULES).artifact;
    const stepped = applyScaling(applyScaling(makeMuffins(), 18, MUFFIN_RULES).artifact, 24, MUFFIN_RULES).artifact;
    expect(stepped.recipe.ingredients.map((i) => i.cookQuantity)).toEqual(
      direct.recipe.ingredients.map((i) => i.cookQuantity),
    );
    expect(direct.recipe.ingredients[1].cookQuantity).toBe("3 1/2 cups (438g)");
    expect(stepped.recipe.steps[0].text).toBe(direct.recipe.steps[0].text);
    expect(stepped.recipe.steps[0].text).toBe("Whisk 1 cup brown sugar into 1/2 cup milk.");
  });
});

describe("adjustArtifact warns about amounts it left as printed", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.MODEL_API_KEY;
    process.env.MODEL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = savedKey;
  });

  it("returns the check note in warnings", async () => {
    const scaling: StructuredChatClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ rules: MUFFIN_RULES }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        },
      },
    };
    const result = await adjustArtifact(makeMuffins(), { servings: 18 }, { clients: { scaling } });
    expect(result.warnings).toEqual([CHECK_NOTE]);
    expect(result.artifact.recipe.ingredients[0].cookQuantity).toBe("3/4 cup (150g)");
  });

  it("the adjust panel shows the note but not the review notes", () => {
    const artifact = {
      reviewNotes: [{ check: "tips_and_voice" as const, status: "failed" as const, detail: "A review note." }],
    };
    expect(adjustNotices([CHECK_NOTE, "A review note."], artifact)).toEqual([CHECK_NOTE]);
    expect(adjustNotices(undefined, artifact)).toEqual([]);
  });
});

describe("ingredient amounts on screen", () => {
  it("prints the unit once", () => {
    expect(formatQuantityWithUnit("3/4 cup (150g)", "cup")).toBe("3/4 cup (150g)");
    expect(formatQuantityWithUnit("2 5/8 cups (329g)", "cups")).toBe("2 5/8 cups (329g)");
    expect(formatQuantityWithUnit("1 cup", "cups")).toBe("1 cup");
    expect(formatQuantityWithUnit("750 grams or 18 oz", "g")).toBe("750 grams or 18 oz");
    expect(formatQuantityWithUnit("a pinch", "pinch")).toBe("a pinch");
    expect(formatQuantityWithUnit("1 1/2 (24-ounce)", "jar")).toBe("1 1/2 (24-ounce) jar");
    expect(formatQuantityWithUnit("2", "large")).toBe("2 large");
    expect(formatQuantityWithUnit("1 1/2", "fl oz")).toBe("1 1/2 fl oz");
    expect(formatQuantityWithUnit("Half a", "")).toBe("Half a");
    expect(formatQuantityWithUnit("", "cup")).toBe("cup");
  });

  it("the ingredients card (also used by the progressive view) shows no doubled unit", () => {
    const scaled = applyScaling(makeMuffins(), 18, MUFFIN_RULES).artifact;
    const html = renderToString(createElement(IngredientsCard, { ingredients: scaled.recipe.ingredients }));
    expect(html).toContain("3/4 cup (150g)</strong>");
    expect(html).not.toContain("(150g) cup");
    expect(html).toContain("1 1/2 teaspoon</strong>");
    expect(html).toContain("buy <!-- -->3/4 cup (150g)");
    expect(html).toContain("Half a</strong>");
  });
});
