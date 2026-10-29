import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { StructuredChatClient } from "../src/lib/model/structured";
import { adjustArtifact } from "../src/lib/pipeline";

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
          scaleRule: null,
          allergens: [],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Add 2 cups stock." }],
      allergens: [],
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
      lanes: [{ id: "lane-a", label: "A", color: "red", kind: "component" }],
      tasks: [
        {
          id: "task-1",
          phase: "cook",
          label: "Cook",
          cardTitle: { action: "Cook", subject: "soup", context: "" },
          description: "Cook for 5 minutes.",
          completionCue: "Done.",
          minutes: 5,
          range: null,
          timingBasis: "estimate",
          sourceQuote: null,
          attention: "hands-on",
          timerEnabledByDefault: false,
          laneIds: ["lane-a"],
          dependencies: [],
          sourceStepIds: ["step-1"],
          checkpoints: [],
          tip: null,
          equipmentEvent: null,
          scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-1"] },
        },
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "task-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function fakeClient(
  order: string[],
  name: string,
  payload: unknown,
): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          order.push(name);
          return {
            choices: [{ message: { content: JSON.stringify(payload) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
}

const RULES_PAYLOAD = {
  rules: [
    { ingredientId: "ing-1", rule: "linear", reason: "main" },
    { ingredientId: "ing-2", rule: "to-taste", reason: "table" },
  ],
};

function transformPayload(kind: string, target: string): unknown {
  return {
    kind,
    target,
    titleOverride: null,
    swaps: [],
    stepOverrides: [],
    techniqueChanges: [],
    rationale: [],
  };
}

const VOICE_PAYLOAD = {
  tasks: [
    {
      taskId: "task-1",
      label: "Cook it, chef",
      description: "Cook for 5 minutes, you have got this.",
      completionCue: "Done and delicious.",
    },
  ],
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

describe("adjustArtifact", () => {
  it("applies servings, dietary, cuisine and voice in order", async () => {
    const order: string[] = [];
    const result = await adjustArtifact(
      makeArtifact(),
      { servings: 4, dietary: "dairy-free", cuisine: "Italian", voice: "sous" },
      {
        clients: {
          scaling: fakeClient(order, "scaling", RULES_PAYLOAD),
          dietary: fakeClient(order, "dietary", transformPayload("dietary", "dairy-free")),
          cuisine: fakeClient(order, "cuisine", transformPayload("cuisine", "Italian")),
          voice: fakeClient(order, "voice", VOICE_PAYLOAD),
        },
      },
    );
    expect(order).toEqual(["scaling", "dietary", "cuisine", "voice"]);
    expect(result.artifact.recipe.servings).toBe(4);
    expect(result.artifact.recipe.ingredients[0].cookQuantity).toBe("4");
    expect(result.artifact.recipe.steps[0].text).toBe("Add 4 cups stock.");
    expect(result.artifact.timelineDefinition.tasks[0].label).toBe("Cook it, chef");
    expect(result.usage.total.totalTokens).toBe(8);
    expect(result.scaleFlags).toEqual([]);
  });

  it("validates every adjustment before any model call", async () => {
    const order: string[] = [];
    const clients = {
      scaling: fakeClient(order, "scaling", RULES_PAYLOAD),
      dietary: fakeClient(order, "dietary", transformPayload("dietary", "dairy-free")),
      cuisine: fakeClient(order, "cuisine", transformPayload("cuisine", "Italian")),
      voice: fakeClient(order, "voice", VOICE_PAYLOAD),
    };
    await expect(
      adjustArtifact(makeArtifact(), { dietary: "keto" }, { clients }),
    ).rejects.toThrow(/unknown dietary/);
    await expect(
      adjustArtifact(makeArtifact(), { voice: "pirate" }, { clients }),
    ).rejects.toThrow(/unsupported voice/);
    await expect(
      adjustArtifact(makeArtifact(), { servings: 99 }, { clients }),
    ).rejects.toThrow(/out of range/);
    await expect(
      adjustArtifact(makeArtifact(), { cuisine: "  " }, { clients }),
    ).rejects.toThrow(/must not be empty/);
    expect(order).toEqual([]);
  });
});
