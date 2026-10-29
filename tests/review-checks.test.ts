import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition, TimelineTask } from "../src/lib/schema/timeline";
import type { ScheduleResult } from "../src/lib/scheduler/schedule";
import type { StructuredChatClient } from "../src/lib/model/structured";
import {
  REVIEW_CHECK_ORDER,
  review,
  runCodedReviewChecks,
  type ReviewCheck,
  type ReviewInput,
} from "../src/lib/stages/review";

function makeRecipe(ingredientIds: string[] = ["ing-1"]): CanonicalRecipe {
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
    ingredients: ingredientIds.map((id, i) => ({
      id,
      name: `ingredient ${i + 1}`,
      quantity: "1",
      unit: "",
      quantity4: null,
      scaleRule: null,
      allergens: [],
      allergenTraces: [],
      note: null,
    })),
    steps: [{ id: "step-1", kind: "active", text: "Simmer for 20 minutes." }],
    equipment: [],
    sourceFingerprint: "sha256:test",
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

function makeTimeline(
  tasks: TimelineTask[],
  holds: Array<{ taskId: string; resourceId: string }> = [],
): TimelineDefinition {
  return {
    lanes: [
      { id: "lane-a", label: "A", color: "red", kind: "component" },
      { id: "lane-kitchen", label: "Kitchen", color: "gray", kind: "kitchen" },
    ],
    tasks,
    resources: [{ id: "pan-1", label: "Pan", kind: "pan" }],
    resourceHolds: holds,
    serveTaskId: tasks[tasks.length - 1].id,
  };
}

function makeSchedule(...entries: Array<[string, number, number]>): ScheduleResult {
  return {
    tasks: entries.map(([id, startMinutes, endMinutes]) => ({ id, startMinutes, endMinutes })),
    criticalPath: [],
    totalMinutes: Math.max(...entries.map(([, , end]) => end)),
  };
}

function makeInput(
  recipe: CanonicalRecipe,
  timeline: TimelineDefinition,
  schedule: ScheduleResult,
): ReviewInput {
  return { recipe, timeline, schedule, equipmentProfile: { burners: 4, oven: true } };
}

function passed(checks: ReviewCheck[], name: string): boolean {
  return checks.find((c) => c.name === name)?.passed ?? false;
}

function fakeClient(judgments: Array<{ name: string; passed: boolean; detail: string }>): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ checks: judgments }) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  };
}

const ALL_PASS = [
  "source_fidelity",
  "quantities",
  "dietary_conditions",
  "method_and_safety",
  "equipment_capacity",
  "source_relationships",
  "tips_and_voice",
].map((name) => ({ name, passed: true, detail: "looks good" }));

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

describe("runCodedReviewChecks", () => {
  it("passes ingredient_coverage when every ingredient is used", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a")]),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(input), "ingredient_coverage")).toBe(true);
  });

  it("fails ingredient_coverage on unused or unknown ingredients", () => {
    const unused = makeInput(
      makeRecipe(["ing-1", "ing-2"]),
      makeTimeline([makeTask("a")]),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(unused), "ingredient_coverage")).toBe(false);
    const unknown = makeInput(
      makeRecipe(),
      makeTimeline([
        makeTask("a", { scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-9"] } }),
      ]),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(unknown), "ingredient_coverage")).toBe(false);
  });

  it("passes mise_en_place when prep ends before cooking starts", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([
        makeTask("p", { phase: "prep", minutes: 4 }),
        makeTask("c", { phase: "cook", minutes: 3 }),
      ]),
      makeSchedule(["p", 0, 4], ["c", 4, 7]),
    );
    expect(passed(runCodedReviewChecks(input), "mise_en_place")).toBe(true);
  });

  it("fails mise_en_place when cooking starts before prep ends", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([
        makeTask("p", { phase: "prep", minutes: 4 }),
        makeTask("c", { phase: "cook", minutes: 3 }),
      ]),
      makeSchedule(["p", 0, 4], ["c", 2, 5]),
    );
    expect(passed(runCodedReviewChecks(input), "mise_en_place")).toBe(false);
  });

  it("passes task_schedule on a consistent schedule", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a"), makeTask("b", { dependencies: ["a"] })]),
      makeSchedule(["a", 0, 5], ["b", 5, 10]),
    );
    expect(passed(runCodedReviewChecks(input), "task_schedule")).toBe(true);
  });

  it("passes task_schedule when a hold arrives through both channels", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline(
        [
          makeTask("a", {
            attention: "unattended",
            scheduling: { waits: [], resourceIds: ["pan-1"], ingredientIds: ["ing-1"] },
          }),
        ],
        [{ taskId: "a", resourceId: "pan-1" }],
      ),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(input), "task_schedule")).toBe(true);
  });

  it("fails task_schedule on hands-on overlap", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a"), makeTask("b")]),
      makeSchedule(["a", 0, 5], ["b", 3, 8]),
    );
    expect(passed(runCodedReviewChecks(input), "task_schedule")).toBe(false);
  });

  it("fails task_schedule when a task starts before its dependencies", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a"), makeTask("b", { dependencies: ["a"] })]),
      makeSchedule(["a", 0, 5], ["b", 2, 7]),
    );
    expect(passed(runCodedReviewChecks(input), "task_schedule")).toBe(false);
  });

  it("passes source_timing on estimates without quotes", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a")]),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(input), "source_timing")).toBe(true);
  });

  it("fails source_timing on a source timing without a quote", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a", { timingBasis: "source", sourceQuote: null })]),
      makeSchedule(["a", 0, 5]),
    );
    expect(passed(runCodedReviewChecks(input), "source_timing")).toBe(false);
  });

  it("passes atomic_attention with checkpoints or at most 15 minutes", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([
        makeTask("a", { minutes: 20, checkpoints: ["halfway"] }),
        makeTask("b", { minutes: 15 }),
      ]),
      makeSchedule(["a", 0, 20], ["b", 20, 35]),
    );
    expect(passed(runCodedReviewChecks(input), "atomic_attention")).toBe(true);
  });

  it("fails atomic_attention on hands-on over 15 minutes without a checkpoint", () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a", { minutes: 20 })]),
      makeSchedule(["a", 0, 20]),
    );
    expect(passed(runCodedReviewChecks(input), "atomic_attention")).toBe(false);
  });
});

describe("review model judgments", () => {
  it("passes with all judgments green and orders all 12 checks", async () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a")]),
      makeSchedule(["a", 0, 5]),
    );
    const result = await review(input, { client: fakeClient(ALL_PASS) });
    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.checks.map((c) => c.name)).toEqual([...REVIEW_CHECK_ORDER]);
  });

  it("blocks compile on failed or missing judgments with readable reasons", async () => {
    const input = makeInput(
      makeRecipe(),
      makeTimeline([makeTask("a")]),
      makeSchedule(["a", 0, 5]),
    );
    const judgments = ALL_PASS.filter((j) => j.name !== "tips_and_voice").map((j) =>
      j.name === "quantities" ? { ...j, passed: false, detail: "salt amount changed" } : j,
    );
    const result = await review(input, { client: fakeClient(judgments) });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("quantities: salt amount changed");
    expect(result.blockers).toContain("tips_and_voice: the model did not judge this check");
  });
});
