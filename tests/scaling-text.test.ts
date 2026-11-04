import { describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { CanonicalIngredient } from "../src/lib/schema/canonical";
import type { TimelineTask } from "../src/lib/schema/timeline";
import { applyScaling, type ScaleRuleAssignment } from "../src/lib/stages/scaling";
import { rescaleText, type AmountMapping } from "../src/lib/scaling/text";
import { nativeServingsOf } from "../src/lib/scaling/native";

const EGGS: AmountMapping = { current: 2, next: 4, unit: "", name: "large eggs" };
const BUTTER: AmountMapping = { current: 350, next: 700, unit: "g", name: "unsalted butter" };

describe("rescaleText", () => {
  it("rescales an amount followed by the ingredient name, never a time", () => {
    expect(rescaleText("Whisk the 2 eggs for 2 minutes", [EGGS]).text).toBe(
      "Whisk the 4 eggs for 2 minutes",
    );
  });

  it("rescales an amount followed by its unit, never a temperature", () => {
    expect(rescaleText("Melt 350 g butter and bake at 350 degrees", [BUTTER]).text).toBe(
      "Melt 700 g butter and bake at 350 degrees",
    );
    expect(rescaleText("Melt 350g butter, then bake at 350°F.", [BUTTER]).text).toBe(
      "Melt 700g butter, then bake at 350°F.",
    );
  });

  it("leaves temperatures, times and pan sizes alone and unreported", () => {
    const mappings: AmountMapping[] = [
      { current: 425, next: 850, unit: "g", name: "flour" },
      { current: 20, next: 40, unit: "", name: "cookies" },
      { current: 9, next: 18, unit: "", name: "eggs" },
      { current: 12, next: 24, unit: "", name: "rolls" },
    ];
    for (const text of [
      "bake at 425°F for 20 minutes",
      "Bake at 425 F for 20 min.",
      "Roast at 220 C for 1 hour.",
      "Pour into a 9x13 pan.",
      "Pour into a 9 x 13 inch pan.",
      "Heat a 12-inch skillet.",
      "Cut into 1/2-inch cubes.",
      "Rest 30 sec, then 2 hrs.",
    ]) {
      const result = rescaleText(text, mappings);
      expect(result.text).toBe(text);
      expect(result.unmatched).toEqual([]);
    }
  });

  it("allows up to two adjectives between the number and the name", () => {
    expect(rescaleText("Crack 2 large fresh eggs.", [EGGS]).text).toBe("Crack 4 large fresh eggs.");
    expect(rescaleText("Crack 2 very large fresh eggs.", [EGGS]).unmatched).toEqual(["2"]);
  });

  it("does not rescale a number whose unit or name appears elsewhere in the step", () => {
    const result = rescaleText("Stir 2 times, then add the eggs.", [EGGS]);
    expect(result.text).toBe("Stir 2 times, then add the eggs.");
    expect(result.unmatched).toEqual(["2"]);
  });

  it("picks the ingredient named after the unit when two share an amount", () => {
    const mappings: AmountMapping[] = [
      { current: 1, next: 2, unit: "cup", name: "chicken stock" },
      { current: 1, next: 1.5, unit: "cup", name: "whole milk" },
    ];
    expect(rescaleText("Add 1 cup stock and 1 cup of the milk.", mappings).text).toBe(
      "Add 2 cup stock and 1 1/2 cup of the milk.",
    );
  });

  it("rescales both ends of a range", () => {
    const mappings: AmountMapping[] = [
      { current: 2, next: 4, unit: "cups", name: "water" },
      { current: 3, next: 6, unit: "cups", name: "water" },
    ];
    expect(rescaleText("Add 2-3 cups water, simmer 2-3 minutes.", mappings).text).toBe(
      "Add 4-6 cups water, simmer 2-3 minutes.",
    );
  });
});

function ing(id: string, name: string, quantity: string, unit: string): CanonicalIngredient {
  return {
    id,
    name,
    quantity,
    unit,
    quantity4: null,
    scaleRule: null,
    cookQuantity: null,
    buyQuantity: null,
    allergens: [],
    allergenTraces: [],
    note: null,
  };
}

function task(id: string, description: string, checkpoints: string[] = []): TimelineTask {
  return {
    id,
    phase: "cook",
    label: "Cook",
    cardTitle: { action: "Cook", subject: "batter", context: "" },
    description,
    completionCue: "Smooth.",
    minutes: 5,
    range: null,
    timingBasis: "estimate",
    sourceQuote: null,
    attention: "hands-on",
    timerEnabledByDefault: false,
    laneIds: ["lane-1"],
    dependencies: [],
    sourceStepIds: ["step-1"],
    checkpoints,
    tip: null,
    equipmentEvent: null,
    scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
  };
}

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-scale",
    recipe: {
      title: "Batter",
      servings: 2,
      nativeServings: 2,
      ingredients: [
        ing("ing-1", "flour", "1", "cup"),
        ing("ing-2", "large eggs", "2", ""),
        ing("ing-3", "butter", "350", "g"),
      ],
      equipment: [],
      steps: [
        { id: "step-1", kind: "active", text: "Whisk 1 cup flour with the 2 eggs for 2 minutes." },
        { id: "step-2", kind: "active", text: "Melt 350 g butter and bake at 350 degrees for 20 minutes." },
      ],
      allergens: [],
      originalMethod: "bake",
      methodLabel: "Baked",
      methodNotice: "",
      credit: { kind: "text", site: null, author: null, url: null, book: null, page: null, license: null },
    },
    timelineDefinition: {
      lanes: [{ id: "lane-1", label: "Batter", color: "#000000", kind: "component" }],
      tasks: [
        task("task-1", "Whisk 1 cup flour with the 2 eggs for 2 minutes.", [
          "2 eggs fully blended",
        ]),
        task("task-2", "Melt 350 g butter; bake at 350 degrees for 20 minutes."),
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "task-2",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

const RULES: ScaleRuleAssignment[] = [
  { ingredientId: "ing-1", rule: "linear", reason: "x" },
  { ingredientId: "ing-2", rule: "linear", reason: "x" },
  { ingredientId: "ing-3", rule: "linear", reason: "x" },
];

describe("applyScaling base and task text", () => {
  it("scales from nativeServings: 2 -> 4 -> 6 equals 2 -> 6", () => {
    const direct = applyScaling(makeArtifact(), 6, RULES).artifact;
    const stepped = applyScaling(applyScaling(makeArtifact(), 4, RULES).artifact, 6, RULES)
      .artifact;
    expect(direct.recipe.ingredients[0].cookQuantity).toBe("3");
    expect(stepped.recipe.ingredients[0].cookQuantity).toBe("3");
    expect(stepped.recipe.ingredients.map((i) => i.cookQuantity)).toEqual(
      direct.recipe.ingredients.map((i) => i.cookQuantity),
    );
    expect(stepped.recipe.steps.map((s) => s.text)).toEqual(direct.recipe.steps.map((s) => s.text));
    expect(stepped.timelineDefinition.tasks.map((t) => t.description)).toEqual(
      direct.timelineDefinition.tasks.map((t) => t.description),
    );
    expect(stepped.recipe.nativeServings).toBe(2);
    // Back down to native returns the printed text.
    const back = applyScaling(stepped, 2, RULES).artifact;
    expect(back.recipe.steps.map((s) => s.text)).toEqual(makeArtifact().recipe.steps.map((s) => s.text));
  });

  it("servings x3 scales amounts in task text and keeps timings", () => {
    const { artifact } = applyScaling(makeArtifact(), 6, RULES);
    const [t1, t2] = artifact.timelineDefinition.tasks;
    expect(t1.description).toBe("Whisk 3 cup flour with the 6 eggs for 2 minutes.");
    expect(t1.checkpoints).toEqual(["6 eggs fully blended"]);
    expect(t2.description).toBe("Melt 1050 g butter; bake at 350 degrees for 20 minutes.");
    expect(artifact.recipe.steps[1].text).toBe(
      "Melt 1050 g butter and bake at 350 degrees for 20 minutes.",
    );
    expect(artifact.timelineDefinition.tasks.map((t) => t.minutes)).toEqual([5, 5]);
  });

  it("falls back to the first rescale change for artifacts without nativeServings", () => {
    const legacy = makeArtifact();
    legacy.recipe.nativeServings = undefined;
    legacy.recipe.servings = 4;
    legacy.changes = [{ kind: "scale", detail: "rescaled 2 → 4 servings (×2)" }];
    expect(nativeServingsOf(legacy.recipe, legacy.changes)).toBe(2);
    legacy.recipe.ingredients[0].cookQuantity = "2";
    const { artifact } = applyScaling(legacy, 6, RULES);
    expect(artifact.recipe.ingredients[0].cookQuantity).toBe("3");
  });
});

describe("rescaleText: shapes the procedure prompt asks for", () => {
  const BEANS: AmountMapping = { current: 1, next: 2, unit: "can", name: "white beans" };
  const BREAD: AmountMapping = { current: 2, next: 4, unit: "slices", name: "sourdough bread" };
  const FLOUR_C: AmountMapping = { current: 2, next: 4, unit: "cups", name: "flour" };
  const VANILLA: AmountMapping = { current: 1, next: 1, unit: "teaspoon", name: "vanilla extract" };

  it("skips a parenthetical package size between the amount and its unit", () => {
    expect(rescaleText("Drain and rinse 1 (15-ounce) can white beans.", [BEANS])).toEqual({
      text: "Drain and rinse 2 (15-ounce) can white beans.",
      unmatched: [],
    });
  });

  it("allows any modifier word before the unit", () => {
    expect(rescaleText("Toast 2 thick slices sourdough bread.", [BREAD])).toEqual({
      text: "Toast 4 thick slices sourdough bread.",
      unmatched: [],
    });
  });

  it("reads a bare c after a small number as cups, and C after an oven number as Celsius", () => {
    expect(rescaleText("Whisk 2 c flour with the milk.", [FLOUR_C])).toEqual({
      text: "Whisk 4 c flour with the milk.",
      unmatched: [],
    });
    expect(rescaleText("Bake at 180 C until golden.", [FLOUR_C])).toEqual({
      text: "Bake at 180 C until golden.",
      unmatched: [],
    });
    expect(rescaleText("Bake at 350 F.", [FLOUR_C]).unmatched).toEqual([]);
  });

  it("never maps a unit-only match onto a different named ingredient", () => {
    const out = rescaleText(
      "Stir in 1 teaspoon of the salt.",
      [VANILLA, { current: 2, next: 4, unit: "teaspoons", name: "kosher salt" }],
      ["vanilla extract", "kosher salt"],
    );
    expect(out).toEqual({ text: "Stir in 1 teaspoon of the salt.", unmatched: ["1"] });
  });
});

describe("applyScaling flags card amounts it cannot rescale", () => {
  it("adds a flag and a change note naming the card", () => {
    const artifact = makeArtifact();
    artifact.timelineDefinition.tasks[0] = {
      ...artifact.timelineDefinition.tasks[0],
      label: "Season the batter",
      description: "Stir in the remaining 1/2 cup flour.",
    };
    const result = applyScaling(artifact, 4, RULES);
    expect(result.flags).toContainEqual({ stepId: "step-1", token: "1/2", card: "Season the batter" });
    expect(result.artifact.changes.map((c) => c.detail)).toContain(
      'Check "1/2" in the "Season the batter" card; it was not rescaled.',
    );
  });
});
