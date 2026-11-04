import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { StructuredChatClient } from "../src/lib/model/structured";
import {
  applyScaling,
  assignScaleRules,
  MAX_SERVINGS,
  MIN_SERVINGS,
  SCALING_VERSION,
  type ScaleRuleAssignment,
} from "../src/lib/stages/scaling";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-test",
    recipe: {
      title: "Test Soup",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "stock",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          allergens: [],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
        {
          id: "ing-2",
          name: "salt",
          quantity: "",
          unit: "",
          quantity4: null,
          scaleRule: "to-taste",
          allergens: [],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [
        { id: "step-1", kind: "active", text: "Add 2 cups stock and simmer 20 minutes." },
      ],
      allergens: [],
      originalMethod: "simmer",
      methodLabel: "Simmered",
      methodNotice: "",
      credit: {
        kind: "text",
        site: null,
        author: null,
        url: null,
        book: null,
        page: null,
        license: null,
      },
    },
    timelineDefinition: {
      lanes: [],
      tasks: [],
      resources: [],
      resourceHolds: [],
      serveTaskId: "task-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

const RULES: ScaleRuleAssignment[] = [
  { ingredientId: "ing-1", rule: "linear", reason: "main liquid" },
  { ingredientId: "ing-2", rule: "to-taste", reason: "seasoned at the table" },
];

function fakeClient(payload: unknown): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  };
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

describe("assignScaleRules", () => {
  it("returns one rule per ingredient from a single call", async () => {
    const seen: Array<{ messages: Array<{ content: unknown }> }> = [];
    const client: StructuredChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            seen.push(params);
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      rules: [
                        { ingredientId: "ing-1", rule: "linear", reason: "main" },
                        { ingredientId: "ing-2", rule: "to-taste", reason: "table" },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
    const result = await assignScaleRules(
      {
        title: "Soup",
        servings: 2,
        ingredients: [
          { id: "ing-1", name: "stock", quantity: "2", unit: "cups" },
          { id: "ing-2", name: "salt", quantity: "", unit: "" },
        ],
        steps: [{ id: "step-1", text: "Simmer." }],
      },
      { client },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => m.content as string).join("\n")).toContain("ing-1");
    expect(result.rules).toHaveLength(2);
    expect(result.usage.totalTokens).toBe(2);
  });

  it("asks for linear rules across a batter or dough, leaveners included", async () => {
    const prompts: string[] = [];
    const client: StructuredChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            prompts.push(params.messages.map((m) => String(m.content)).join("\n"));
            return {
              choices: [
                { message: { content: JSON.stringify({ rules: [{ ingredientId: "bp", rule: "linear", reason: "batter" }] }) } },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
    await assignScaleRules(
      {
        title: "Muffins",
        servings: 12,
        ingredients: [{ id: "bp", name: "baking powder", quantity: "2", unit: "tsp" }],
        steps: [{ id: "step-1", text: "Whisk." }],
      },
      { client },
    );
    expect(prompts[0]).toContain("every ingredient in a batter or dough is linear, leaveners and salt included");
    expect(prompts[0]).not.toMatch(/sublinear:[^\n]*leaveners/);
    expect(SCALING_VERSION).toBe(3);
  });

  it("rejects an invalid rule through validation", async () => {
    await expect(
      assignScaleRules(
        {
          title: "Soup",
          servings: 2,
          ingredients: [{ id: "ing-1", name: "stock", quantity: "2", unit: "cups" }],
          steps: [],
        },
        {
          client: fakeClient({
            rules: [{ ingredientId: "ing-1", rule: "exponential", reason: "x" }],
          }),
        },
      ),
    ).rejects.toThrow(/failed validation/);
  });
});

describe("applyScaling", () => {
  it("accepts the serving bounds and rejects outside them", () => {
    expect(MIN_SERVINGS).toBe(0.5);
    expect(MAX_SERVINGS).toBe(36);
    expect(() => applyScaling(makeArtifact(), 0.5, RULES)).not.toThrow();
    expect(() => applyScaling(makeArtifact(), 12.1, RULES)).not.toThrow();
    expect(() => applyScaling(makeArtifact(), 36, RULES)).not.toThrow();
    expect(() => applyScaling(makeArtifact(), 0.49, RULES)).toThrow(/out of range \(0.5-36\)/);
    expect(() => applyScaling(makeArtifact(), 36.1, RULES)).toThrow(/out of range/);
    expect(() => applyScaling(makeArtifact(), 37, RULES)).toThrow(/out of range/);
    expect(() => applyScaling(makeArtifact(), Number.NaN, RULES)).toThrow(/out of range/);
  });

  it("makes 18 muffins from a dozen-muffin recipe", () => {
    const base = makeArtifact();
    base.recipe.title = "Muffins";
    base.recipe.servings = 12;
    base.recipe.nativeServings = 12;
    base.recipe.ingredients = [
      { ...base.recipe.ingredients[0], id: "flour", name: "flour", quantity: "2", unit: "cups" },
      { ...base.recipe.ingredients[0], id: "eggs", name: "eggs", quantity: "2", unit: "" },
      { ...base.recipe.ingredients[0], id: "bp", name: "baking powder", quantity: "2", unit: "tsp" },
      { ...base.recipe.ingredients[0], id: "milk", name: "milk", quantity: "1 1/4", unit: "cups" },
    ];
    base.recipe.steps = [
      { id: "step-1", kind: "active", text: "Whisk 2 cups flour with 2 tsp baking powder." },
      { id: "step-2", kind: "active", text: "Beat 2 eggs into 1 1/4 cups milk. Bake 20 minutes at 400°F." },
    ];
    const rules: ScaleRuleAssignment[] = ["flour", "eggs", "bp", "milk"].map((id) => ({
      ingredientId: id,
      rule: "linear",
      reason: "baking keeps its ratios",
    }));
    const { artifact, flags } = applyScaling(base, 18, rules);
    expect(artifact.recipe.servings).toBe(18);
    expect(artifact.recipe.nativeServings).toBe(12);
    expect(artifact.recipe.ingredients.map((i) => i.cookQuantity)).toEqual(["3", "3", "3", "1 7/8"]);
    // Buy amounts round up and always cover the cook amount.
    expect(artifact.recipe.ingredients.map((i) => i.buyQuantity)).toEqual(["3", "3", "3", "2"]);
    expect(artifact.recipe.steps.map((s) => s.text)).toEqual([
      "Whisk 3 cups flour with 3 tsp baking powder.",
      "Beat 3 eggs into 1 7/8 cups milk. Bake 20 minutes at 400°F.",
    ]);
    expect(flags).toEqual([]);
    expect(artifact.changes[0]).toEqual({ kind: "scale", detail: "rescaled 12 → 18 servings (×1.5)" });
  });

  it("scales a two-serving recipe all the way to 36, from the printed amounts", () => {
    const { artifact } = applyScaling(makeArtifact(), 36, RULES);
    expect(artifact.recipe.ingredients[0].cookQuantity).toBe("36");
    expect(artifact.recipe.ingredients[1].cookQuantity).toBe("");
    expect(artifact.recipe.steps[0].text).toBe("Add 36 cups stock and simmer 20 minutes.");
    expect(artifact.changes[0]).toEqual({ kind: "scale", detail: "rescaled 2 → 36 servings (×18)" });
    // A second change scales from the printed amounts again, not from 36.
    const again = applyScaling(artifact, 18, RULES).artifact;
    expect(again.recipe.ingredients[0].cookQuantity).toBe("18");
    expect(again.recipe.steps[0].text).toBe("Add 18 cups stock and simmer 20 minutes.");
  });

  it("throws when a rule is missing", () => {
    expect(() => applyScaling(makeArtifact(), 4, RULES.slice(0, 1))).toThrow(
      /missing scale rule for ing-2/,
    );
  });

  it("rescales mapped step numbers and leaves timings unflagged", () => {
    const { artifact, flags } = applyScaling(makeArtifact(), 4, RULES);
    expect(artifact.recipe.servings).toBe(4);
    expect(artifact.recipe.ingredients[0].cookQuantity).toBe("4");
    expect(artifact.recipe.ingredients[0].buyQuantity).toBe("4");
    expect(artifact.recipe.ingredients[0].scaleRule).toBe("linear");
    expect(artifact.recipe.ingredients[1].cookQuantity).toBe("");
    expect(artifact.recipe.steps[0].text).toBe("Add 4 cups stock and simmer 20 minutes.");
    // "20 minutes" is a time, never an amount: unchanged and not flagged.
    expect(flags).toEqual([]);
    expect(artifact.changes[0]).toEqual({
      kind: "scale",
      detail: "rescaled 2 → 4 servings (×2)",
    });
  });

  it("flags amount-like numbers that match no ingredient", () => {
    const base = makeArtifact();
    base.recipe.steps = [
      { id: "step-1", kind: "active", text: "Add 2 cups stock and 3 bay leaves." },
    ];
    const { artifact, flags } = applyScaling(base, 4, RULES);
    expect(artifact.recipe.steps[0].text).toBe("Add 4 cups stock and 3 bay leaves.");
    expect(flags).toEqual([{ stepId: "step-1", token: "3" }]);
    expect(artifact.changes).toContainEqual({
      kind: "scale",
      detail: 'Check "3" in step 1; it was not rescaled.',
    });
  });
});
