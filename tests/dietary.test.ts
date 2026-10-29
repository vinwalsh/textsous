import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { StructuredChatClient } from "../src/lib/model/structured";
import type { VariantTransform } from "../src/lib/schema/variant";
import { applyDietary } from "../src/lib/stages/dietary";

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
          name: "milk",
          quantity: "1",
          unit: "cup",
          quantity4: null,
          scaleRule: null,
          allergens: ["milk"],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Add the milk." }],
      allergens: ["milk"],
      originalMethod: "",
      methodLabel: "",
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

function fakeClient(transform: VariantTransform): {
  client: StructuredChatClient;
  calls: () => number;
} {
  let calls = 0;
  const client: StructuredChatClient = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return {
            choices: [{ message: { content: JSON.stringify(transform) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
  return { client, calls: () => calls };
}

const OAT_SWAP: VariantTransform = {
  kind: "dietary",
  target: "dairy-free",
  titleOverride: null,
  swaps: [
    {
      fromIngredientId: "ing-1",
      to: { name: "oat milk", quantity: "1", unit: "cup" },
      omitReason: null,
      reason: "closest match",
      packageRequirements: ["certified dairy-free"],
    },
  ],
  stepOverrides: [],
  techniqueChanges: [],
  rationale: [],
};

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

describe("applyDietary", () => {
  it("plans and applies a transform, dropping the restricted allergen", async () => {
    const { client } = fakeClient(OAT_SWAP);
    const applied = await applyDietary(makeArtifact(), "dairy-free", { client });
    expect(applied.artifact.recipe.ingredients[0].name).toBe("oat milk");
    expect(applied.artifact.recipe.allergens).toEqual([]);
    expect(applied.removedNames).toContain("milk");
  });

  it("rejects an unknown target without calling the model", async () => {
    const { client, calls } = fakeClient(OAT_SWAP);
    await expect(applyDietary(makeArtifact(), "keto", { client })).rejects.toThrow(
      /unknown dietary target/,
    );
    expect(calls()).toBe(0);
  });
});
