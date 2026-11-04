import { describe, expect, it } from "vitest";
import { MAX_TASK_MINUTES, TaskRangeSchema, TimelineTaskSchema } from "../src/lib/schema/timeline";

describe("task length", () => {
  it("lets one task run 4 hours (a long simmer), up to 12 hours", () => {
    const minutes = TimelineTaskSchema.shape.minutes;
    expect(MAX_TASK_MINUTES).toBe(720);
    expect(minutes.safeParse(240).success).toBe(true);
    expect(minutes.safeParse(720).success).toBe(true);
    expect(minutes.safeParse(721).success).toBe(false);
    expect(TaskRangeSchema.safeParse({ low: 240, high: 300 }).success).toBe(true);
  });
});
