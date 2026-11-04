import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TimelineDefinitionSchema, type TimelineDefinition } from "../src/lib/schema/timeline";
import { schedule } from "../src/lib/scheduler/schedule";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { closestId, editDistance, repairTimelineReferences } from "../src/lib/stages/repair-refs";

function porridge(): { recipe: ProcedureRecordingFile["recipe"]; timeline: TimelineDefinition } {
  const recording = JSON.parse(
    readFileSync(join(process.cwd(), "eval/recordings", "procedure-toasted-oat-porridge.json"), "utf8"),
  ) as ProcedureRecordingFile;
  return { recipe: recording.recipe, timeline: TimelineDefinitionSchema.parse(JSON.parse(recording.response)) };
}

function typo(id: string): string {
  // Drop one letter from the middle, like the live "t-sofen" for "t-soften".
  const at = Math.floor(id.length / 2);
  return id.slice(0, at) + id.slice(at + 1);
}

describe("closest id", () => {
  it("finds a near miss and refuses ties and far guesses", () => {
    expect(editDistance("t-sofen", "t-soften")).toBe(1);
    expect(closestId("t-sofen", ["t-soften", "t-simmer"])).toBe("t-soften");
    expect(closestId("t-ab", ["t-ac", "t-ad"])).toBeNull();
    expect(closestId("t-unknown", ["t-soften"])).toBeNull();
  });
});

describe("repairTimelineReferences", () => {
  it("lets the scheduler run on a hold with a typo'd task id (the live t-sofen failure)", () => {
    const { recipe, timeline } = porridge();
    const target = timeline.tasks[1].id;
    const resource = timeline.resources[0]?.id ?? "r-stove";
    const broken: TimelineDefinition = {
      ...timeline,
      resources: timeline.resources.length ? timeline.resources : [{ id: resource, label: "Stove", kind: "burner" } as never],
      resourceHolds: [...timeline.resourceHolds, { taskId: typo(target), resourceId: resource }],
    };
    expect(() => schedule(broken)).toThrow(/hold references unknown task/);
    const { timeline: fixed, fixes } = repairTimelineReferences(recipe, broken);
    expect(fixed.resourceHolds.at(-1)).toEqual({ taskId: target, resourceId: resource });
    expect(fixes.join(" ")).toContain(target);
    expect(() => schedule(fixed)).not.toThrow();
  });

  it("maps or drops unknown dependencies, lanes, steps and the serve task", () => {
    const { recipe, timeline } = porridge();
    const [first, second] = timeline.tasks;
    const broken: TimelineDefinition = {
      ...timeline,
      serveTaskId: "t-nowhere-at-all",
      tasks: timeline.tasks.map((task) =>
        task.id === second.id
          ? {
              ...task,
              dependencies: [typo(first.id), "t-made-up-entirely", second.id],
              laneIds: ["lane-that-does-not-exist-anywhere"],
              sourceStepIds: ["step-that-does-not-exist-anywhere"],
            }
          : task,
      ),
    };
    const { timeline: fixed } = repairTimelineReferences(recipe, broken);
    const repaired = fixed.tasks.find((task) => task.id === second.id)!;
    expect(repaired.dependencies).toEqual(second.phase === "prep" && first.phase !== "prep" ? [] : [first.id]);
    expect(repaired.laneIds).toEqual([timeline.lanes[0].id]);
    expect(repaired.sourceStepIds).toEqual([recipe.steps[0].id]);
    expect(fixed.tasks.map((task) => task.id)).toContain(fixed.serveTaskId);
    expect(() => schedule(fixed)).not.toThrow();
  });

  it("leaves a clean timeline exactly as it was", () => {
    const { recipe, timeline } = porridge();
    const { timeline: fixed, fixes } = repairTimelineReferences(recipe, timeline);
    expect(fixes).toEqual([]);
    expect(fixed).toEqual(timeline);
  });
});
