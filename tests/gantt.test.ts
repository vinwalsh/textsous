import { describe, expect, it } from "vitest";
import { renderGantt } from "../src/lib/gantt";
import type { ScheduleResult } from "../src/lib/scheduler/schedule";
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

const timeline: TimelineDefinition = {
  lanes: [{ id: "lane-a", label: "Sauce", color: "red", kind: "component" }],
  tasks: [
    task("chop", { label: "Chop onions", minutes: 5 }),
    task("simmer", {
      label: "Simmer sauce",
      minutes: 10,
      attention: "unattended",
      dependencies: ["chop"],
    }),
  ],
  resources: [],
  resourceHolds: [],
  serveTaskId: "simmer",
};

const schedule: ScheduleResult = {
  tasks: [
    { id: "chop", startMinutes: 0, endMinutes: 5 },
    { id: "simmer", startMinutes: 5, endMinutes: 15 },
  ],
  criticalPath: ["chop", "simmer"],
  totalMinutes: 15,
};

describe("renderGantt", () => {
  it("renders the title, total time and one row per task", () => {
    const out = renderGantt("Soup", timeline, schedule);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Soup — 15m total");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Chop onions");
    expect(lines[2]).toContain("Simmer sauce");
    expect(lines[1]).toContain("cook, hands-on");
  });

  it("marks hands-on with # and unattended with =, offset by start", () => {
    const out = renderGantt("Soup", timeline, schedule);
    const lines = out.split("\n");
    expect(lines[1]).toContain("[#####          ]");
    expect(lines[2]).toContain("[     ==========]");
  });
});
