import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { StructuredChatClient } from "../src/lib/model/structured";
import {
  applyScaling,
  assignScaleRules,
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
    expect(() => applyScaling(makeArtifact(), 0.5, RULES)).not.toThrow();
    expect(() => applyScaling(makeArtifact(), 12, RULES)).not.toThrow();
    expect(() => applyScaling(makeArtifact(), 0.49, RULES)).toThrow(/out of range/);
    expect(() => applyScaling(makeArtifact(), 12.1, RULES)).toThrow(/out of range/);
  });

  it("throws when a rule is missing", () => {
    expect(() => applyScaling(makeArtifact(), 4, RULES.slice(0, 1))).toThrow(
      /missing scale rule for ing-2/,
    );
  });

  it("rescales mapped step numbers and flags the rest", () => {
    const { artifact, flags } = applyScaling(makeArtifact(), 4, RULES);
    expect(artifact.recipe.servings).toBe(4);
    expect(artifact.recipe.ingredients[0].cookQuantity).toBe("4");
    expect(artifact.recipe.ingredients[0].buyQuantity).toBe("4");
    expect(artifact.recipe.ingredients[0].scaleRule).toBe("linear");
    expect(artifact.recipe.ingredients[1].cookQuantity).toBe("");
    expect(artifact.recipe.steps[0].text).toBe("Add 4 cups stock and simmer 20 minutes.");
    expect(flags).toEqual([{ stepId: "step-1", token: "20" }]);
    expect(artifact.changes[0]).toEqual({
      kind: "scale",
      detail: "rescaled 2 → 4 servings (×2)",
    });
    expect(artifact.changes).toContainEqual({
      kind: "scale",
      detail: 'verify "20" in step step-1 (not rescaled)',
    });
  });
});
