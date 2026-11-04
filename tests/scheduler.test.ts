import { describe, expect, it } from "vitest";
import { schedule, type ScheduleResult } from "../src/lib/scheduler/schedule";
import type { TimelineDefinition, TimelineTask } from "../src/lib/schema/timeline";

function task(id: string, overrides: Partial<TimelineTask> = {}): TimelineTask {
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
    scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
    ...overrides,
  };
}

function timeline(
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
    serveTaskId: "serve",
  };
}

function serve(minutes = 2): TimelineTask {
  return task("serve", { phase: "finish", minutes });
}

function times(result: ScheduleResult): Record<string, [number, number]> {
  return Object.fromEntries(
    result.tasks.map((t) => [t.id, [t.startMinutes, t.endMinutes]]),
  );
}

describe("schedule", () => {
  it("never overlaps hands-on tasks for one cook", () => {
    const result = schedule(
      timeline([task("a", { minutes: 5 }), task("b", { minutes: 3 }), serve()]),
    );
    expect(times(result)).toEqual({ a: [0, 5], b: [5, 8], serve: [8, 10] });
    expect(result.totalMinutes).toBe(10);
    expect(result.criticalPath).toEqual(["a"]);
  });

  it("overlaps unattended tasks freely", () => {
    const result = schedule(
      timeline([
        task("a", { minutes: 10 }),
        task("u", { minutes: 10, attention: "unattended" }),
        serve(),
      ]),
    );
    expect(times(result)).toEqual({ a: [0, 10], u: [0, 10], serve: [10, 12] });
    expect(result.totalMinutes).toBe(12);
  });

  it("respects dependencies", () => {
    const result = schedule(
      timeline([
        task("a", { minutes: 5 }),
        task("b", { minutes: 3, dependencies: ["a"] }),
        serve(),
      ]),
    );
    expect(times(result)).toEqual({ a: [0, 5], b: [5, 8], serve: [8, 10] });
    expect(result.criticalPath).toEqual(["a", "b"]);
  });

  it("respects resource holds across unattended tasks", () => {
    const result = schedule(
      timeline(
        [
          task("u1", { minutes: 5, attention: "unattended" }),
          task("u2", { minutes: 5, attention: "unattended" }),
          serve(),
        ],
        [
          { taskId: "u1", resourceId: "pan-1" },
          { taskId: "u2", resourceId: "pan-1" },
        ],
      ),
    );
    expect(times(result)).toEqual({ u1: [0, 5], u2: [5, 10], serve: [10, 12] });
    expect(result.totalMinutes).toBe(12);
  });

  it("finishes all prep before the first cook task", () => {
    const result = schedule(
      timeline([
        task("p", { phase: "prep", minutes: 4 }),
        task("c", { phase: "cook", minutes: 3 }),
        serve(),
      ]),
    );
    expect(times(result)).toEqual({ p: [0, 4], c: [4, 7], serve: [7, 9] });
  });

  it("runs the serve task last even without dependencies", () => {
    const result = schedule(
      timeline([task("a", { minutes: 5, attention: "unattended" }), serve()]),
    );
    expect(times(result)).toEqual({ a: [0, 5], serve: [5, 7] });
  });

  it("waits after dependencies before starting", () => {
    const result = schedule(
      timeline([
        task("a", { minutes: 5, scheduling: { waits: [120, 60], resourceIds: [], ingredientIds: [] } }),
        serve(),
      ]),
    );
    expect(times(result)).toEqual({ a: [3, 8], serve: [8, 10] });
  });

  // The guide's oven rule: preheat first, the first oven task depends on it
  // and waits 600 s. The oven heats while the cook preps, so the heat-up
  // counts from the preheat, not from the last prep task.
  function ovenRecipe(preheatLast = false): TimelineDefinition {
    const preheat = task("preheat", { phase: "prep", minutes: 1, laneIds: ["lane-kitchen"], equipmentEvent: "oven-on" });
    const slice = task("slice", { phase: "prep", minutes: 8 });
    return timeline([
      ...(preheatLast ? [slice, preheat] : [preheat, slice]),
      task("toss", { minutes: 2, dependencies: ["slice"] }),
      task("roast", {
        minutes: 20,
        attention: "unattended",
        dependencies: ["preheat", "toss"],
        scheduling: { waits: [600], resourceIds: [], ingredientIds: [] },
      }),
      task("serve", { phase: "finish", minutes: 1, dependencies: ["roast"] }),
    ]);
  }

  it("counts the oven heat-up from the preheat, not from the last dependency", () => {
    const result = schedule(ovenRecipe());
    // The oven is hot at 11, when tossing ends: no idle 10 minutes after it.
    expect(times(result)).toEqual({
      preheat: [0, 1],
      slice: [1, 9],
      toss: [9, 11],
      roast: [11, 31],
      serve: [31, 32],
    });
    expect(result.totalMinutes).toBe(32);
    // By dependencies alone, the heat-up (1 + 10) outlasts slice and toss (8 + 2).
    expect(result.criticalPath).toEqual(["preheat", "roast", "serve"]);
  });

  it("still gives the oven its full heat-up when the preheat comes late", () => {
    const result = schedule(ovenRecipe(true));
    expect(times(result).preheat).toEqual([8, 9]);
    expect(times(result).roast).toEqual([19, 39]);
  });

  it("reports the critical path and total time", () => {
    const result = schedule(
      timeline([
        task("a", { minutes: 2 }),
        task("b", { minutes: 5, dependencies: ["a"] }),
        task("c", { minutes: 2, dependencies: ["a"] }),
        task("d", { minutes: 1, dependencies: ["b", "c"] }),
        serve(1),
      ]),
    );
    expect(times(result)).toEqual({
      a: [0, 2],
      b: [2, 7],
      c: [7, 9],
      d: [9, 10],
      serve: [10, 11],
    });
    expect(result.criticalPath).toEqual(["a", "b", "d"]);
    expect(result.totalMinutes).toBe(11);
  });

  it("throws on dependency cycles", () => {
    expect(() =>
      schedule(
        timeline([
          task("a", { dependencies: ["b"] }),
          task("b", { dependencies: ["a"] }),
          serve(),
        ]),
      ),
    ).toThrow(/cycle/);
  });

  it("throws when a prep task depends on a non-prep task", () => {
    expect(() =>
      schedule(
        timeline([
          task("a", { minutes: 5 }),
          task("p", { phase: "prep", dependencies: ["a"] }),
          serve(),
        ]),
      ),
    ).toThrow(/non-prep/);
  });
});
