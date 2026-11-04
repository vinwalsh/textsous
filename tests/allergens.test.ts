import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyArtifactAllergenFloor,
  inferAllergens,
  rollUpTraces,
  withAllergenFloor,
} from "../src/lib/allergens";
import { compile } from "../src/lib/stages/compile";
import type { CanonicalIngredient, CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition } from "../src/lib/schema/timeline";
import ArtifactViewer from "../src/app/ArtifactViewer";

type Row = [name: string, note: string | null, allergens: string[], traces: string[]];

// name, note, expected definite allergens, expected traces
const TABLE: Row[] = [
  // Stroganoff, as production converted it (flour untagged).
  ["all-purpose flour", null, ["gluten"], []],
  ["Worcestershire sauce", null, ["fish"], []],
  ["unsalted butter", null, ["milk"], []],
  ["sour cream", null, ["milk"], []],
  ["Dijon mustard", null, ["mustard"], []],
  ["beef stock", null, [], ["celery"]],
  ["egg noodles", null, ["gluten", "egg"], []],
  ["beef sirloin", "cut into strips", [], []],
  ["cremini mushrooms", "sliced", [], []],
  // Gluten
  ["whole wheat bread", null, ["gluten"], []],
  ["panko breadcrumbs", null, ["gluten"], []],
  ["spaghetti", null, ["gluten"], []],
  ["couscous", null, ["gluten"], []],
  ["pearl barley", null, ["gluten"], []],
  ["lager beer", null, ["gluten"], []],
  ["soy sauce", null, ["gluten", "soy"], []],
  ["gluten-free soy sauce", null, ["soy"], []],
  ["GF flour blend", null, [], []],
  ["almond flour", null, ["nuts"], []],
  ["coconut flour", null, [], []],
  ["rice flour", null, [], []],
  ["chickpea flour", null, [], []],
  ["rice noodles", null, [], []],
  ["glass noodles", null, [], []],
  ["gluten-free pasta", null, [], []],
  ["rolled oats", null, [], ["gluten"]],
  ["buckwheat groats", null, [], []],
  ["breadfruit", null, [], []],
  // Milk
  ["whole milk", null, ["milk"], []],
  ["buttermilk", null, ["milk"], []],
  ["heavy cream", null, ["milk"], []],
  ["crème fraîche", null, ["milk"], []],
  ["Parmigiano-Reggiano", "finely grated", ["milk"], []],
  ["feta cheese", null, ["milk"], []],
  ["Greek yogurt", null, ["milk"], []],
  ["ghee", null, ["milk"], []],
  ["milk chocolate", null, ["milk"], []],
  ["coconut milk", null, [], []],
  ["coconut cream", null, [], []],
  ["cream of tartar", null, [], []],
  ["almond milk", null, ["nuts"], []],
  ["oat milk", null, [], ["gluten"]],
  ["soy milk", null, ["soy"], []],
  ["rice milk", null, [], []],
  ["peanut butter", null, ["peanuts"], []],
  ["vegan butter", null, [], []],
  ["butternut squash", null, [], []],
  ["butter beans", null, [], []],
  // Egg
  ["eggs", null, ["egg"], []],
  ["egg yolks", null, ["egg"], []],
  ["large egg", "beaten", ["egg"], []],
  ["mayonnaise", null, ["egg"], []],
  ["eggplant", null, [], []],
  // Fish, crustaceans, molluscs
  ["anchovies", null, ["fish"], []],
  ["salmon fillets", null, ["fish"], []],
  ["fish sauce", null, ["fish"], []],
  ["shrimp", "peeled", ["crustaceans"], []],
  ["lobster tails", null, ["crustaceans"], []],
  ["mussels", null, ["molluscs"], []],
  ["oyster sauce", null, ["molluscs"], []],
  ["oyster mushrooms", null, [], []],
  // Nuts and peanuts
  ["walnuts", "toasted", ["nuts"], []],
  ["Brazil nuts", null, ["nuts"], []],
  ["pistachios", null, ["nuts"], []],
  ["macadamia nuts", null, ["nuts"], []],
  ["hazelnuts", null, ["nuts"], []],
  ["cashews", null, ["nuts"], []],
  ["pecans", null, ["nuts"], []],
  ["roasted peanuts", null, ["peanuts"], []],
  ["pine nuts", null, [], []],
  ["nutmeg", null, [], []],
  ["water chestnuts", null, [], []],
  ["coconut", "shredded", [], []],
  // Sesame, soy
  ["tahini", null, ["sesame"], []],
  ["toasted sesame oil", null, ["sesame"], []],
  ["firm tofu", null, ["soy"], []],
  ["white miso", null, ["soy"], []],
  ["edamame", null, ["soy"], []],
  ["tempeh", null, ["soy"], []],
  // Mustard, celery
  ["mustard seeds", null, ["mustard"], []],
  ["dry mustard powder", null, ["mustard"], []],
  ["celery", "diced", ["celery"], []],
  ["celeriac", null, ["celery"], []],
  ["celery salt", null, ["celery"], []],
  ["chicken broth", null, [], ["celery"]],
  ["vegetable bouillon", null, [], ["celery"]],
  // Sulphites, lupin
  ["dry white wine", null, ["sulphites"], []],
  ["dry sherry", null, ["sulphites"], []],
  ["dried apricots", null, ["sulphites"], []],
  ["lupin flour", null, ["lupin"], []],
  // Notes count too.
  ["sauce base", "made with butter and flour", ["gluten", "milk"], []],
];

describe("inferAllergens (EU-14 floor)", () => {
  it.each(TABLE)("%s (%s)", (name, note, allergens, traces) => {
    const inferred = inferAllergens(name, note);
    expect([...inferred.allergens].sort()).toEqual([...allergens].sort());
    expect([...inferred.traces].sort()).toEqual([...traces].sort());
  });
});

function ingredient(
  id: string,
  name: string,
  quantity: string,
  unit: string,
  allergens: CanonicalIngredient["allergens"] = [],
  note: string | null = null,
): CanonicalIngredient {
  return {
    id,
    name,
    quantity,
    unit,
    quantity4: null,
    scaleRule: null,
    cookQuantity: null,
    buyQuantity: null,
    allergens,
    allergenTraces: [],
    note,
  };
}

const STROGANOFF: CanonicalIngredient[] = [
  ingredient("ing-1", "beef sirloin", "1", "lb", [], "cut into strips"),
  ingredient("ing-2", "all-purpose flour", "2", "tbsp"),
  ingredient("ing-3", "unsalted butter", "3", "tbsp", ["milk"]),
  ingredient("ing-4", "beef stock", "1 1/2", "cups"),
  ingredient("ing-5", "Worcestershire sauce", "1", "tsp"),
  ingredient("ing-6", "Dijon mustard", "1", "tbsp", ["mustard"]),
  ingredient("ing-7", "sour cream", "1/2", "cup", ["milk"]),
];

describe("withAllergenFloor", () => {
  it("never removes a model tag and appends inferred ones", () => {
    const tagged = withAllergenFloor({
      ...ingredient("ing-1", "spinach", "1", "cup", ["sesame"]),
      allergenTraces: ["soy" as const],
    });
    expect(tagged.allergens).toEqual(["sesame"]);
    expect(tagged.allergenTraces).toEqual(["soy"]);
    const flour = withAllergenFloor(ingredient("ing-2", "flour", "1", "cup", ["milk"]));
    expect(flour.allergens).toEqual(["milk", "gluten"]);
  });

  it("returns the same object when nothing is added", () => {
    const ing = ingredient("ing-1", "carrots", "2", "");
    expect(withAllergenFloor(ing)).toBe(ing);
  });
});

function recipe(ingredients: CanonicalIngredient[]): CanonicalRecipe {
  return {
    version: 1,
    id: "rcp-stroganoff",
    title: "Beef Stroganoff",
    source: { kind: "text" },
    nativeServings: 4,
    ingredients,
    steps: [{ id: "step-1", kind: "active", text: "Cook it all." }],
    equipment: [],
    sourceFingerprint: "fp-stroganoff",
  };
}

const TIMELINE: TimelineDefinition = {
  lanes: [{ id: "lane-k", label: "Kitchen", color: "#000000", kind: "kitchen" }],
  tasks: [
    {
      id: "task-1",
      phase: "cook",
      label: "Cook",
      cardTitle: { action: "Cook", subject: "stroganoff", context: "" },
      description: "Cook it all.",
      completionCue: "Done.",
      minutes: 20,
      range: null,
      timingBasis: "estimate",
      sourceQuote: null,
      attention: "hands-on",
      timerEnabledByDefault: false,
      laneIds: ["lane-k"],
      dependencies: [],
      sourceStepIds: ["step-1"],
      checkpoints: [],
      tip: null,
      equipmentEvent: null,
      scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
    },
  ],
  resources: [],
  resourceHolds: [],
  serveTaskId: "task-1",
};

const PASSED_REVIEW = {
  passed: true,
  blockers: [],
  checks: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  fallbackUsed: false,
  attempts: 0,
  rawResponse: "",
};

describe("compile allergen roll-up", () => {
  it("floors the stroganoff: gluten, fish, milk, mustard plus a celery trace", () => {
    const artifact = compile({
      recipe: recipe(STROGANOFF),
      timeline: TIMELINE,
      review: PASSED_REVIEW,
      equipmentProfile: { burners: 4, oven: true },
    });
    expect(artifact.recipe.allergens).toEqual(["fish", "gluten", "milk", "mustard"]);
    const stock = artifact.recipe.ingredients.find((i) => i.id === "ing-4");
    expect(stock?.allergenTraces).toEqual(["celery"]);
    expect(rollUpTraces(artifact.recipe.ingredients)).toEqual(["celery"]);
  });

  it("floors a cached artifact and the viewer shows the contains copy", () => {
    const artifact = compile({
      recipe: recipe(STROGANOFF),
      timeline: TIMELINE,
      review: PASSED_REVIEW,
      equipmentProfile: { burners: 4, oven: true },
    });
    // Simulate an artifact saved before the floor existed.
    const legacy = {
      ...artifact,
      recipe: {
        ...artifact.recipe,
        ingredients: recipe(STROGANOFF).ingredients,
        allergens: ["milk" as const, "mustard" as const],
      },
    };
    const floored = applyArtifactAllergenFloor(legacy);
    expect(floored.recipe.allergens).toEqual(["fish", "gluten", "milk", "mustard"]);
    expect(applyArtifactAllergenFloor(floored)).toBe(floored);
    const html = renderToString(
      createElement(ArtifactViewer, { artifact: legacy, onStartOver: () => {} }),
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Contains:");
    expect(html).toMatch(/fish, gluten, milk, mustard\..*May contain: celery\./);
    expect(html).toContain("This list can miss things. Check every label.");
  });
});
