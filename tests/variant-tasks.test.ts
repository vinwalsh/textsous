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
    expect(warnings.some((w) => w.includes("\"Brown butter\" was reworded"))).toBe(true);
    expect(warnings.some((w) => /task-|step-\d/.test(w))).toBe(false);
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
    expect(warnings.some((w) => w.startsWith("\"Simmer porridge\""))).toBe(true);
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

describe("removal rewording never leaves broken or stale cards", () => {
  it("removes amount, unit and prep words with the name, and keeps a following verb clause", () => {
    const parmesan = { oldName: "parmesan cheese", newName: null, head: "cheese" };
    expect(
      rewordForSwap("Sprinkle with 1/4 cup grated parmesan cheese and serve.", parmesan, []),
    ).toBe("Serve.");
    expect(rewordForSwap("Add the cheese and stir until melted.", parmesan, [])).toBe(
      "Stir until melted.",
    );
    expect(rewordForSwap("Top with the cheese and basil.", parmesan, [])).toBe("Top with basil.");
    expect(
      rewordForSwap("Toss with 2 tablespoons freshly grated parmesan cheese, basil and salt.", parmesan, []),
    ).toBe("Toss with basil and salt.");
  });

  function task(
    id: string,
    label: string,
    description: string,
    extra: Partial<CookAlongArtifact["timelineDefinition"]["tasks"][number]> = {},
  ): CookAlongArtifact["timelineDefinition"]["tasks"][number] {
    return {
      id,
      phase: "cook",
      label,
      cardTitle: { action: label.split(" ")[0], subject: label.split(" ").slice(1).join(" ") || "step", context: "" },
      description,
      completionCue: "Done.",
      minutes: 4,
      range: null,
      timingBasis: "estimate",
      sourceQuote: null,
      attention: "hands-on",
      timerEnabledByDefault: true,
      laneIds: ["lane-k"],
      dependencies: [],
      sourceStepIds: ["step-1"],
      checkpoints: [],
      tip: null,
      why: null,
      equipmentEvent: null,
      scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
      ...extra,
    };
  }

  function salad(toastExtra: Partial<CookAlongArtifact["timelineDefinition"]["tasks"][number]> = {}): CookAlongArtifact {
    const base = porridge();
    return {
      ...base,
      recipe: {
        ...base.recipe,
        ingredients: [
          { ...base.recipe.ingredients[0], id: "ing-1", name: "mixed greens", allergens: [], allergenTraces: [] },
          { ...base.recipe.ingredients[0], id: "ing-2", name: "sliced almonds", allergens: ["nuts"], allergenTraces: [] },
        ],
      },
      timelineDefinition: {
        lanes: [{ id: "lane-k", label: "Kitchen", color: "#AAA398", kind: "kitchen" }],
        tasks: [
          task("task-toast", "Toast the almonds", "Toast the almonds in a dry pan for about 4 minutes.", {
            scheduling: { waits: [], resourceIds: ["pan-1"], ingredientIds: ["ing-2"] },
            ...toastExtra,
          }),
          task("task-toss", "Toss the greens", "Toss the greens.", {
            dependencies: ["task-toast"],
            scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-1"] },
          }),
          task("task-serve", "Serve the salad", "Serve right away.", {
            phase: "finish",
            dependencies: ["task-toss"],
          }),
        ],
        resources: [{ id: "pan-1", label: "Dry pan", kind: "pan" }],
        resourceHolds: [{ taskId: "task-toast", resourceId: "pan-1" }],
        serveTaskId: "task-serve",
      },
    };
  }

  const NUT_FREE: VariantTransform = {
    kind: "dietary",
    target: "nut-free",
    titleOverride: null,
    swaps: [
      {
        fromIngredientId: "ing-2",
        to: null,
        omitReason: "garnish only",
        reason: "nut-free",
        packageRequirements: [],
      },
    ],
    stepOverrides: [],
    techniqueChanges: [],
    rationale: [],
  };

  it("drops a card that only handled the removed ingredient and rewires its dependents", () => {
    const { artifact, warnings } = applyVariant(salad(), NUT_FREE);
    const tasks = artifact.timelineDefinition.tasks;
    expect(tasks.map((t) => t.id)).toEqual(["task-toss", "task-serve"]);
    expect(tasks[0].dependencies).toEqual([]);
    expect(artifact.timelineDefinition.resourceHolds).toEqual([]);
    expect(allTaskText(artifact).join(" ")).not.toMatch(/almond/i);
    expect(warnings.join(" ")).toMatch(/Toast the almonds" only handled sliced almonds, so it was removed/);
    expect(() => TimelineDefinitionSchema.parse(artifact.timelineDefinition)).not.toThrow();
  });

  it("keeps an emptied card that cannot be dropped as a skip card with no timer", () => {
    const { artifact } = applyVariant(salad({ equipmentEvent: "oven-on" }), NUT_FREE);
    const toast = artifact.timelineDefinition.tasks.find((t) => t.id === "task-toast");
    expect(toast?.label).toBe("Skip this step");
    expect(toast?.timerEnabledByDefault).toBe(false);
    expect(toast?.description).toBe("Skip the sliced almonds for this version.");
    expect(toast?.cardTitle).toEqual({ action: "Skip", subject: "this step", context: "" });
  });
});
