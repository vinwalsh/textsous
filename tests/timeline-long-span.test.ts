import { describe, expect, it } from "vitest";
import { buildTimelineGeometry, spanPixels } from "../src/lib/cooking-pilot/timeline-layout";

describe("long spans on the Cook Along timeline", () => {
  it("draws the first 20 minutes in full and compresses the rest", () => {
    expect(spanPixels(10)).toBe(120);
    expect(spanPixels(20)).toBe(240);
    expect(spanPixels(240)).toBe(240 + 220 * 12 * 0.05);
    expect(spanPixels(0)).toBe(0);
  });

  it("keeps a 4-hour simmer to a card you scroll past, with the guide aligned", () => {
    const plan = {
      totalMinutes: 260,
      tasks: [
        { id: "brown", startMinute: 0, endMinute: 10, checkpoints: [] },
        { id: "simmer", startMinute: 10, endMinute: 250, checkpoints: [] },
        { id: "serve", startMinute: 250, endMinute: 260, checkpoints: [] },
      ],
    };
    const geometry = buildTimelineGeometry(plan);
    const simmer = geometry.position(250) - geometry.position(10);
    expect(simmer).toBeLessThan(500);
    expect(simmer).toBeGreaterThanOrEqual(220);
    expect(geometry.totalHeight).toBeLessThan(1100);
    // position() stays monotonic across the compressed span.
    expect(geometry.position(130)).toBeGreaterThan(geometry.position(30));
    expect(geometry.position(130)).toBeLessThan(geometry.position(250));
  });
});
