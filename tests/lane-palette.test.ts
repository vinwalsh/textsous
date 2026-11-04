import { describe, expect, it } from "vitest";
import {
  KITCHEN_LANE_COLOR,
  LANE_PALETTE,
  componentLaneColor,
  laneDisplayColors,
  taskLaneColor,
} from "../src/lib/lane-palette";
import { COOK_ALONG_EXAMPLE, CookAlongRequestSchema } from "../src/lib/skills";
import { normalize } from "../src/lib/skills/normalize";

const NO_SOURCE = {
  kind: "text" as const,
  url: null,
  site: null,
  author: null,
  book: null,
  page: null,
  license: null,
  text: null,
};

describe("lane palette", () => {
  it("is the six muted earth tones plus the kitchen grey", () => {
    expect(LANE_PALETTE).toEqual(["#B58D3D", "#587454", "#B94C39", "#477653", "#8A6F9E", "#3F7A8C"]);
    expect(KITCHEN_LANE_COLOR).toBe("#AAA398");
  });

  it("colors component lanes by position and wraps after six", () => {
    expect(componentLaneColor(0)).toBe("#B58D3D");
    expect(componentLaneColor(5)).toBe("#3F7A8C");
    expect(componentLaneColor(6)).toBe("#B58D3D");
    expect(componentLaneColor(-1)).toBe("#B58D3D");
  });

  it("ignores stored colors: components in order, the kitchen lane grey", () => {
    const colors = laneDisplayColors([
      { id: "lane-sauce", kind: "component" },
      { id: "lane-rice", kind: "component" },
      { id: "lane-kitchen", kind: "kitchen" },
    ]);
    expect([...colors.entries()]).toEqual([
      ["lane-sauce", "#B58D3D"],
      ["lane-rice", "#587454"],
      ["lane-kitchen", "#AAA398"],
    ]);
    // The kitchen lane does not use up a palette slot.
    const many = laneDisplayColors([
      ...Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, kind: "component" })),
      { id: "k", kind: "kitchen" },
    ]);
    expect(many.get("c6")).toBe("#B58D3D");
    expect(many.get("k")).toBe("#AAA398");
  });

  it("colors a task by its first lane", () => {
    const colors = laneDisplayColors([
      { id: "a", kind: "component" },
      { id: "b", kind: "component" },
      { id: "k", kind: "kitchen" },
    ]);
    expect(taskLaneColor(colors, ["b", "k"])).toBe("#587454");
    expect(taskLaneColor(colors, ["missing"])).toBe("#AAA398");
    expect(taskLaneColor(colors, [])).toBe("#AAA398");
  });

  it("is the default for lanes an assistant sends without a color", () => {
    const body = CookAlongRequestSchema.parse(JSON.parse(JSON.stringify(COOK_ALONG_EXAMPLE)));
    const { timeline } = normalize(body, NO_SOURCE);
    expect(timeline.lanes.map((l) => [l.kind, l.color])).toEqual([
      ["component", "#B58D3D"],
      ["component", "#587454"],
      ["kitchen", "#AAA398"],
    ]);
  });

  it("keeps a valid color the assistant sent", () => {
    const body = CookAlongRequestSchema.parse(JSON.parse(JSON.stringify(COOK_ALONG_EXAMPLE)));
    body.timeline.lanes[0].color = "#123456";
    const { timeline } = normalize(body, NO_SOURCE);
    expect(timeline.lanes[0].color).toBe("#123456");
    expect(timeline.lanes[1].color).toBe("#587454");
  });
});
