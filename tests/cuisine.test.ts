import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { StructuredChatClient } from "../src/lib/model/structured";
import type { VariantTransform } from "../src/lib/schema/variant";
import { applyCuisine } from "../src/lib/stages/cuisine";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-test",
    recipe: {
      title: "Test Soup",
      servings: 2,
      ingredients: ["stock", "salt", "pepper"].map((name, i) => ({
        id: `ing-${i + 1}`,
        name,
        quantity: "1",
        unit: "cup",
        quantity4: null,
        scaleRule: null,
        allergens: [],
        allergenTraces: [],
        note: null,
        cookQuantity: null,
        buyQuantity: null,
      })),
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Simmer." }],
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

function swap(fromIngredientId: string, name: string): VariantTransform["swaps"][number] {
  return {
    fromIngredientId,
    to: { name, quantity: "1", unit: "cup" },
    omitReason: null,
    reason: "infusion",
    packageRequirements: [],
  };
}

function baseTransform(swaps: VariantTransform["swaps"]): VariantTransform {
  return {
    kind: "cuisine",
    target: "Italian",
    titleOverride: null,
    swaps,
    stepOverrides: [],
    techniqueChanges: [],
    rationale: [],
  };
}

function fakeClient(transform: VariantTransform): {
  client: StructuredChatClient;
  calls: number;
} {
  const state = { calls: 0 };
  const client: StructuredChatClient = {
    chat: {
      completions: {
        create: async () => {
          state.calls += 1;
          return {
            choices: [{ message: { content: JSON.stringify(transform) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
  return { client, calls: state.calls };
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

describe("applyCuisine", () => {
  it("applies a transform within the one-third swap budget", async () => {
    const { client } = fakeClient(baseTransform([swap("ing-1", "parmesan broth")]));
    const applied = await applyCuisine(makeArtifact(), "Italian", { client });
    expect(applied.artifact.recipe.ingredients[0].name).toBe("parmesan broth");
    expect(applied.transform.target).toBe("Italian");
  });

  it("refuses transforms that swap more than a third", async () => {
    const { client } = fakeClient(
      baseTransform([swap("ing-1", "a"), swap("ing-2", "b")]),
    );
    await expect(applyCuisine(makeArtifact(), "Italian", { client })).rejects.toThrow(
      /exceed a third/,
    );
  });

  it("refuses swaps that reintroduce earlier-removed ingredients", async () => {
    const { client } = fakeClient(baseTransform([swap("ing-1", "Milk")]));
    await expect(
      applyCuisine(makeArtifact(), "Italian", { client, forbiddenNames: ["milk"] }),
    ).rejects.toThrow(/reintroduces/);
  });

  it("rejects an empty target without calling the model", async () => {
    const { client } = fakeClient(baseTransform([]));
    await expect(applyCuisine(makeArtifact(), "  ", { client })).rejects.toThrow(
      /must not be empty/,
    );
  });
});
