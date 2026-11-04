import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import { TimelineDefinitionSchema } from "../src/lib/schema/timeline";
import type { VariantTransform } from "../src/lib/schema/variant";
import type { StructuredChatClient } from "../src/lib/model/structured";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { compile } from "../src/lib/stages/compile";
import { applyVariant } from "../src/lib/variant-apply";
import { adjustArtifact } from "../src/lib/pipeline";
import { rewordForSwap } from "../src/lib/variant-text";

const PASSED_REVIEW = {
  passed: true,
  blockers: [],
  checks: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  fallbackUsed: false,
  attempts: 0,
  rawResponse: "",
};

/** Porridge fixture (our own recipe), compiled from its recordings. */
function porridge(): CookAlongArtifact {
  const recording = JSON.parse(
    readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
  ) as ProcedureRecordingFile;
  const timeline = TimelineDefinitionSchema.parse(JSON.parse(recording.response));
  return compile({
    recipe: recording.recipe,
    timeline,
    review: PASSED_REVIEW,
    equipmentProfile: { burners: 4, oven: true },
  });
}

function vegan(overrides: Partial<VariantTransform> = {}): VariantTransform {
  return {
    kind: "dietary",
    target: "vegan",
    titleOverride: null,
    swaps: [
      {
        fromIngredientId: "ing-2",
        to: { name: "oat drink", quantity: "2", unit: "cups" },
        reason: "plant-based",
        packageRequirements: ["no milk ingredients"],
      },
      {
        fromIngredientId: "ing-3",
        to: { name: "coconut oil", quantity: "1", unit: "tablespoon" },
        reason: "plant-based fat",
        packageRequirements: [],
      },
    ],
    stepOverrides: [],
    techniqueChanges: [],
    rationale: [],
    ...overrides,
  };
}

const DAIRY = /\b(butter|milk|cheese)\b/i;

function allTaskText(artifact: CookAlongArtifact): string[] {
  return artifact.timelineDefinition.tasks.flatMap((t) => [
    t.label,
    t.cardTitle.action,
    t.cardTitle.subject,
    t.cardTitle.context,
    t.description,
    t.completionCue,
    ...t.checkpoints,
    t.tip ?? "",
  ]);
}

describe("variant step cards", () => {
  it("vegan without task overrides leaves no task text naming butter, milk or cheese", () => {
    const before = porridge();
    expect(allTaskText(before).some((t) => DAIRY.test(t))).toBe(true);
    const { artifact, warnings } = applyVariant(before, vegan());
    const offending = allTaskText(artifact).filter((t) => DAIRY.test(t));
    expect(offending).toEqual([]);
    expect(artifact.recipe.steps.filter((s) => DAIRY.test(s.text))).toEqual([]);
    const melt = artifact.timelineDefinition.tasks.find((t) => t.id === "task-melt-butter");
    expect(melt?.description).toBe("Melt the coconut oil in a small skillet until it foams and smells nutty.");
    expect(melt?.cardTitle.subject).toBe("coconut oil");
    expect(warnings.some((w) => w.includes("task-melt-butter"))).toBe(true);
    expect(artifact.changes.some((c) => c.detail.includes("reworded automatically"))).toBe(true);
    // Timings, ids and structure unchanged.
    expect(artifact.timelineDefinition.tasks.map((t) => [t.id, t.minutes])).toEqual(
      before.timelineDefinition.tasks.map((t) => [t.id, t.minutes]),
    );
  });

  it("applies a model task override and rewords the tasks it left out", () => {
    const { artifact, warnings } = applyVariant(
      porridge(),
      vegan({
        taskOverrides: [
          {
            taskId: "task-melt-butter",
            label: "Warm coconut oil",
            description: "Warm the coconut oil in a small skillet until it shimmers.",
            completionCue: "Oil shimmers.",
            checkpoints: null,
          },
        ],
      }),
    );
    const melt = artifact.timelineDefinition.tasks.find((t) => t.id === "task-melt-butter");
    expect(melt?.description).toBe("Warm the coconut oil in a small skillet until it shimmers.");
    expect(melt?.label).toBe("Warm coconut oil");
    expect(allTaskText(artifact).filter((t) => DAIRY.test(t))).toEqual([]);
    expect(warnings.some((w) => w.startsWith("task task-simmer-porridge"))).toBe(true);
  });

  it("drops an override that changes a timing or names a removed ingredient", () => {
    const base = porridge();
    base.timelineDefinition.tasks = base.timelineDefinition.tasks.map((t) =>
      t.id === "task-melt-butter" ? { ...t, description: "Melt the butter for 3 minutes." } : t,
    );
    const timing = applyVariant(
      base,
      vegan({
        taskOverrides: [
          { taskId: "task-melt-butter", description: "Warm the coconut oil for 5 minutes." },
        ],
      }),
    );
    const melt = timing.artifact.timelineDefinition.tasks.find((t) => t.id === "task-melt-butter");
    expect(melt?.description).toBe("Melt the coconut oil for 3 minutes.");
    expect(timing.warnings.some((w) => /changed a timing/.test(w))).toBe(true);

    const named = applyVariant(
      porridge(),
      vegan({
        taskOverrides: [
          { taskId: "task-simmer-porridge", description: "Pour the milk over the oats." },
        ],
      }),
    );
    const simmer = named.artifact.timelineDefinition.tasks.find(
      (t) => t.id === "task-simmer-porridge",
    );
    expect(DAIRY.test(simmer?.description ?? "")).toBe(false);
    expect(named.warnings.some((w) => /named a removed ingredient/.test(w))).toBe(true);
  });

  it("drops the clause for a removed ingredient", () => {
    const swap = { oldName: "ground cinnamon", newName: null, head: "cinnamon" };
    expect(
      rewordForSwap("Add the diced apple, brown sugar, and cinnamon; cook until soft.", swap, []),
    ).toBe("Add the diced apple and brown sugar; cook until soft.");
    expect(rewordForSwap("Add salt, pepper, sugar and cinnamon.", swap, [])).toBe(
      "Add salt, pepper and sugar.",
    );
    expect(rewordForSwap("Add the cinnamon and sugar.", swap, [])).toBe("Add sugar.");
    expect(rewordForSwap("Dust with cinnamon. Serve warm.", swap, [])).toBe("Serve warm.");
  });

  it("never doubles a substitute that contains the old head noun", () => {
    const swap = { oldName: "unsalted butter", newName: "vegan butter", head: "butter" };
    expect(rewordForSwap("Melt the butter, then add vegan butter.", swap, ["vegan butter"])).toBe(
      "Melt the vegan butter, then add vegan butter.",
    );
  });
});

describe("adjustArtifact servings then vegan", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.MODEL_API_KEY;
    process.env.MODEL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = savedKey;
  });

  function client(payload: unknown, seen?: string[]): StructuredChatClient {
    return {
      chat: {
        completions: {
          create: async (params) => {
            seen?.push(params.messages.map((m) => String(m.content)).join("\n"));
            return {
              choices: [{ message: { content: JSON.stringify(payload) } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
  }

  it("sends current amounts to the dietary prompt and keeps quantity at native scale", async () => {
    const base = porridge();
    const rules = base.recipe.ingredients.map((i) => ({
      ingredientId: i.id,
      rule: "linear",
      reason: "x",
    }));
    const seen: string[] = [];
    const transform = vegan();
    transform.swaps[0].to = { name: "oat drink", quantity: "4", unit: "cups" };
    const result = await adjustArtifact(
      base,
      { servings: base.recipe.servings * 2, dietary: "vegan" },
      { clients: { scaling: client({ rules }), dietary: client(transform, seen) } },
    );
    // Milk was 2 cups at native; the dietary prompt saw the doubled 4.
    expect(seen[0]).toContain('"id":"ing-2","name":"whole milk","quantity":"4"');
    expect(seen[0]).toContain("task-melt-butter");
    const drink = result.artifact.recipe.ingredients.find((i) => i.id === "ing-2");
    expect(drink?.cookQuantity).toBe("4");
    expect(drink?.quantity).toBe("2");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(allTaskText(result.artifact).filter((t) => DAIRY.test(t))).toEqual([]);
  });
});
