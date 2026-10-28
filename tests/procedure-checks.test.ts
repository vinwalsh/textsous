import { describe, expect, it } from "vitest";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import { runProcedureChecks, type ProcedureCheck } from "../src/lib/stages/procedure";
import type { TimelineDefinition, TimelineTask } from "../src/lib/schema/timeline";

function makeRecipe(): CanonicalRecipe {
  return {
    version: 1,
    id: "rcp-test",
    title: "Test Soup",
    source: {
      kind: "text",
      url: null,
      site: null,
      author: null,
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
        name: "onion",
        quantity: "1",
        unit: "",
        quantity4: null,
        scaleRule: null,
        allergens: [],
        allergenTraces: [],
        note: null,
      },
    ],
    steps: [{ id: "step-1", kind: "active", text: "Simmer the soup for 20 minutes." }],
    equipment: [],
    sourceFingerprint: "sha256:test",
  };
}

function makeTask(overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: "task-1",
    phase: "cook",
    label: "Simmer the soup",
    cardTitle: { action: "Simmer", subject: "soup", context: "" },
    description: "Simmer until done.",
    completionCue: "Soup is hot.",
    minutes: 20,
    range: null,
    timingBasis: "source",
    sourceQuote: "for 20 minutes",
    attention: "unattended",
    timerEnabledByDefault: true,
    laneIds: ["lane-base"],
    dependencies: [],
    sourceStepIds: ["step-1"],
    checkpoints: [],
    tip: null,
    equipmentEvent: null,
    scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-1"] },
    ...overrides,
  };
}

function makeTimeline(
  tasks: TimelineTask[] = [makeTask()],
  lanes: TimelineDefinition["lanes"] = [
    { id: "lane-base", label: "Base", color: "red", kind: "component" },
    { id: "lane-kitchen", label: "Kitchen", color: "gray", kind: "kitchen" },
  ],
): TimelineDefinition {
  return { lanes, tasks, resources: [], resourceHolds: [], serveTaskId: "task-1" };
}

function passed(checks: ProcedureCheck[], name: string): boolean {
  return checks.find((c) => c.name === name)?.passed ?? false;
}

describe("runProcedureChecks", () => {
  it("passes when the timeline matches the recipe", () => {
    const checks = runProcedureChecks(makeRecipe(), makeTimeline());
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails source_step_ids on unknown step ids", () => {
    const timeline = makeTimeline([makeTask({ sourceStepIds: ["step-9"] })]);
    expect(passed(runProcedureChecks(makeRecipe(), timeline), "source_step_ids")).toBe(false);
  });

  it("fails source_quotes without a quote, with a non-verbatim quote, or a quote on an estimate", () => {
    const recipe = makeRecipe();
    expect(
      passed(
        runProcedureChecks(
          recipe,
          makeTimeline([makeTask({ sourceQuote: null })]),
        ),
        "source_quotes",
      ),
    ).toBe(false);
    expect(
      passed(
        runProcedureChecks(
          recipe,
          makeTimeline([makeTask({ sourceQuote: "for 45 minutes" })]),
        ),
        "source_quotes",
      ),
    ).toBe(false);
    expect(
      passed(
        runProcedureChecks(
          recipe,
          makeTimeline([makeTask({ timingBasis: "estimate", sourceQuote: "for 20 minutes" })]),
        ),
        "source_quotes",
      ),
    ).toBe(false);
  });

  it("fails task_references on broken dependencies and serve task", () => {
    const recipe = makeRecipe();
    expect(
      passed(
        runProcedureChecks(recipe, makeTimeline([makeTask({ dependencies: ["task-9"] })])),
        "task_references",
      ),
    ).toBe(false);
    const timeline = makeTimeline();
    timeline.serveTaskId = "task-9";
    expect(passed(runProcedureChecks(recipe, timeline), "task_references")).toBe(false);
  });

  it("fails lanes without exactly one final kitchen lane", () => {
    const recipe = makeRecipe();
    const flipped = makeTimeline(undefined, [
      { id: "lane-kitchen", label: "Kitchen", color: "gray", kind: "kitchen" },
      { id: "lane-base", label: "Base", color: "red", kind: "component" },
    ]);
    expect(passed(runProcedureChecks(recipe, flipped), "lanes")).toBe(false);
    const noKitchen = makeTimeline(undefined, [
      { id: "lane-base", label: "Base", color: "red", kind: "component" },
    ]);
    expect(passed(runProcedureChecks(recipe, noKitchen), "lanes")).toBe(false);
  });

  it("fails timers when a timer defaults on without a source timing", () => {
    const timeline = makeTimeline([
      makeTask({ timingBasis: "estimate", sourceQuote: null, timerEnabledByDefault: true }),
    ]);
    expect(passed(runProcedureChecks(makeRecipe(), timeline), "timers")).toBe(false);
  });
});
