import { describe, expect, it } from "vitest";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition, TimelineTask } from "../src/lib/schema/timeline";
import { compile, deriveMethod, type CompileInput } from "../src/lib/stages/compile";
import type { ReviewResult } from "../src/lib/stages/review";

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    version: 1,
    id: "rcp-test",
    title: "Test Soup",
    source: {
      kind: "url",
      url: "https://example.com/soup",
      site: "Example",
      author: "A",
      book: null,
      page: null,
      license: null,
    },
    cuisine: null,
    nativeServings: 2,
    servingsLarge: null,
    scalingNotes: null,
    ingredients: [
      {
        id: "ing-1",
        name: "milk",
        quantity: "1",
        unit: "cup",
        quantity4: null,
        scaleRule: null,
        allergens: ["milk"],
        allergenTraces: ["soy"],
        note: null,
      },
      {
        id: "ing-2",
        name: "flour",
        quantity: "2",
        unit: "cups",
        quantity4: null,
        scaleRule: null,
        allergens: ["gluten", "milk"],
        allergenTraces: [],
        note: null,
      },
    ],
    steps: [{ id: "step-1", kind: "active", text: "Simmer the soup." }],
    equipment: ["pot"],
    sourceFingerprint: "sha256:test",
    ...overrides,
  };
}

function makeTask(id: string, overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id,
    phase: "cook",
    label: id,
    cardTitle: { action: "Do", subject: id, context: "" },
    description: id,
    completionCue: "done",
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
    ...overrides,
  };
}

function makeTimeline(tasks: TimelineTask[]): TimelineDefinition {
  return {
    lanes: [
      { id: "lane-a", label: "A", color: "red", kind: "component" },
      { id: "lane-kitchen", label: "Kitchen", color: "gray", kind: "kitchen" },
    ],
    tasks,
    resources: [],
    resourceHolds: [],
    serveTaskId: tasks[tasks.length - 1].id,
  };
}

function passReview(): ReviewResult {
  return {
    checks: [],
    passed: true,
    blockers: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    fallbackUsed: false,
    attempts: 1,
    rawResponse: "{}",
  };
}

function makeInput(
  recipe: CanonicalRecipe,
  timeline: TimelineDefinition,
): CompileInput {
  return {
    recipe,
    timeline,
    review: passReview(),
    equipmentProfile: { burners: 4, oven: true },
  };
}

describe("compile", () => {
  it("assembles a valid artifact with copied credit and passed-through timeline", () => {
    const recipe = makeRecipe();
    const timeline = makeTimeline([makeTask("a")]);
    const artifact = compile(makeInput(recipe, timeline));
    expect(artifact.formatVersion).toBe(1);
    expect(artifact.id).toMatch(/^art-[0-9a-f]{12}$/);
    expect(artifact.recipe.title).toBe("Test Soup");
    expect(artifact.recipe.servings).toBe(2);
    expect(artifact.recipe.credit).toEqual({
      kind: "url",
      site: "Example",
      author: "A",
      url: "https://example.com/soup",
      book: null,
      page: null,
      license: null,
    });
    expect(artifact.timelineDefinition).toEqual(timeline);
    expect(artifact.equipmentProfile).toEqual({ burners: 4, oven: true });
    expect(artifact.recipe.methodNotice).toBe("");
  });

  it("rolls up declared allergens, sorted and deduped", () => {
    const artifact = compile(makeInput(makeRecipe(), makeTimeline([makeTask("a")])));
    expect(artifact.recipe.allergens).toEqual(["gluten", "milk"]);
  });

  it("lists merged steps and estimates in changes", () => {
    const timeline = makeTimeline([
      makeTask("a", { sourceStepIds: ["step-1", "step-2"] }),
      makeTask("b", {
        timingBasis: "source",
        sourceQuote: "for 20 minutes",
        sourceStepIds: ["step-1"],
      }),
    ]);
    const artifact = compile(makeInput(makeRecipe(), timeline));
    expect(artifact.changes).toContainEqual({
      kind: "merged-steps",
      detail: "a merges step-1, step-2",
    });
    expect(artifact.changes).toContainEqual({
      kind: "estimate",
      detail: "a timing is estimated",
    });
    expect(artifact.changes.some((c) => c.detail.startsWith("b "))).toBe(false);
  });

  it("refuses to compile when review failed, with the readable reasons", () => {
    const input = makeInput(makeRecipe(), makeTimeline([makeTask("a")]));
    input.review = {
      ...passReview(),
      passed: false,
      blockers: ["quantities: salt amount changed", "timers: timer without source"],
    };
    expect(() => compile(input)).toThrow(
      /compile blocked: quantities: salt amount changed; timers: timer without source/,
    );
  });

  it("assigns deterministic ids per recipe and timeline", () => {
    const timeline = makeTimeline([makeTask("a")]);
    const first = compile(makeInput(makeRecipe(), timeline));
    const second = compile(makeInput(makeRecipe(), timeline));
    expect(first.id).toBe(second.id);
    const other = compile(
      makeInput(makeRecipe({ sourceFingerprint: "sha256:other" }), timeline),
    );
    expect(other.id).not.toBe(first.id);
  });
});

describe("deriveMethod", () => {
  it("names the first heat method in step order", () => {
    expect(deriveMethod([{ text: "Char on a hot grill." }])).toEqual({
      method: "grill",
      label: "Grilled",
    });
    expect(
      deriveMethod([{ text: "Toast the bread." }, { text: "Simmer the soup." }]),
    ).toEqual({ method: "toast", label: "Toasted" });
  });

  it("returns empty strings when no heat method is named", () => {
    expect(deriveMethod([{ text: "Toss everything together." }])).toEqual({
      method: "",
      label: "",
    });
  });
});
