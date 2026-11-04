import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import { MAX_TASK_MINUTES as OPEN_MAX_TASK_MINUTES } from "../src/lib/schema/timeline";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../src/lib/schema/artifact";
import { LANE_PALETTE, KITCHEN_LANE_COLOR } from "../src/lib/lane-palette";
import { schedule } from "../src/lib/scheduler/schedule";
import {
  adaptArtifactForCookingPilot,
  artifactFingerprint,
  cookingPilotInput,
} from "../src/lib/cooking-pilot/from-artifact";
import { buildCookingPlan, cookingTimelineDefinitionSchema, MAX_TASK_MINUTES } from "../src/lib/cooking-pilot/plan";
import { sha256Hex } from "../src/lib/cooking-pilot/sha256";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const FIXTURES = ["toasted-oat-porridge", "charred-corn-salad", "herby-white-bean-toast"];
// Conversions of two /demo-sites recipes (CC0, written for this repo).
const DEMO_SITE_ARTIFACTS = ["lemon-blueberry-muffins", "skillet-cornbread"].map((name) => ({
  name,
  artifact: CookAlongArtifactSchema.parse(
    JSON.parse(readFileSync(`tests/fixtures/cook-along/${name}.json`, "utf8")),
  ),
}));
const ALL = [
  ...FIXTURES.map((name) => ({ name, artifact: fixtureArtifact(name) })),
  ...DEMO_SITE_ARTIFACTS,
];

function clone(artifact: CookAlongArtifact): CookAlongArtifact {
  return structuredClone(artifact);
}

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("crème brûlée")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("the Cook Along view's task cap", () => {
  it("matches the open format's 12-hour task limit", () => {
    expect(MAX_TASK_MINUTES).toBe(OPEN_MAX_TASK_MINUTES);
  });
});

describe.each(ALL)("adaptArtifactForCookingPilot: $name", ({ artifact }) => {
  const input = adaptArtifactForCookingPilot(artifact);
  const definition = input.timelineDefinition;

  it("passes the view's schema and scheduler", () => {
    expect(cookingTimelineDefinitionSchema.safeParse(definition).success).toBe(true);
    const plan = buildCookingPlan(definition);
    expect(plan.tasks).toHaveLength(artifact.timelineDefinition.tasks.length);
    expect(plan.serveMinute).toBeGreaterThan(0);
    // Phase bands from Mise en Place to serving.
    expect(plan.phaseSpans.map((span) => span.phaseId)).toEqual(definition.phases.map((phase) => phase.id));
  });

  it("binds the recipe to the definition", () => {
    expect(input.recipe.sourceFingerprint).toBe(definition.sourceFingerprint);
    expect(input.recipe.sourceFingerprint).toBe(artifactFingerprint(artifact));
    expect(input.recipe.effectiveIdentity).toBe(definition.effectiveIdentity);
    expect(input.recipe.servings).toBe(definition.servings);
    expect(definition.supportedSource).toMatchObject({ kind: "generated-serving-profile", servings: artifact.recipe.servings });
    expect(input.recipe.title).toBe(artifact.recipe.title);
    expect(input.recipe.ingredients).toHaveLength(artifact.recipe.ingredients.length);
    expect(input.recipe.steps.map((step) => step.text)).toEqual(artifact.recipe.steps.map((step) => step.text));
  });

  it("keeps one kitchen lane, last, in the open palette", () => {
    const kitchens = definition.lanes.filter((lane) => lane.kind === "kitchen");
    expect(kitchens).toHaveLength(1);
    expect(definition.lanes.at(-1)?.kind).toBe("kitchen");
    expect(kitchens[0].color).toBe(KITCHEN_LANE_COLOR);
    const components = definition.lanes.filter((lane) => lane.kind === "component");
    components.forEach((lane, index) => expect(lane.color).toBe(LANE_PALETTE[index % LANE_PALETTE.length]));
  });

  it("carries every task's words, timing and lanes", () => {
    for (const open of artifact.timelineDefinition.tasks) {
      const task = definition.tasks.find((candidate) => candidate.id === open.id);
      expect(task, open.id).toBeDefined();
      if (!task) continue;
      expect(task.minutes).toBe(open.minutes);
      expect(task.timingBasis).toBe(open.timingBasis);
      expect(task.attention).toBe(open.attention);
      expect(task.timerEnabledByDefault).toBe(open.timerEnabledByDefault);
      expect(task.description.startsWith(open.description.trim())).toBe(true);
      expect(task.completionCue).toBe(open.completionCue.trim());
      for (const dep of open.dependencies) expect(task.dependencies).toContain(dep);
      expect(task.scheduling.waits.map((wait) => wait.taskId)).toEqual(task.dependencies);
    }
  });

  it("serves at the end, like the open schedule", () => {
    const plan = buildCookingPlan(definition);
    const serve = plan.tasks.find((task) => task.id === definition.serveTaskId);
    expect(serve?.endMinute).toBe(Math.max(...plan.tasks.map((task) => task.endMinute)));
    // Same constraints, a different solver: within a few minutes of the open schedule.
    expect(Math.abs(plan.serveMinute - schedule(artifact.timelineDefinition).totalMinutes)).toBeLessThanOrEqual(10);
  });

  it("is ready for the view (cookingPilotInput)", () => {
    expect(cookingPilotInput(artifact)).not.toBeNull();
  });
});

describe("adaptArtifactForCookingPilot mapping rules", () => {
  const base = fixtureArtifact("toasted-oat-porridge");

  it("puts a wait on the dependencies the open scheduler counts it from", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks.find((t) => t.dependencies.length > 0);
    expect(task).toBeDefined();
    if (!task) return;
    task.scheduling.waits = [120, 60];
    const adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks.find((t) => t.id === task.id);
    for (const wait of adapted?.scheduling.waits ?? []) {
      expect(wait.minWaitSeconds).toBe(task.dependencies.includes(wait.taskId) ? 180 : 0);
      expect(wait.maxWaitSeconds).toBeGreaterThanOrEqual(wait.minWaitSeconds);
    }
  });

  it("counts the oven heat-up from the preheat only", () => {
    const artifact = clone(base);
    const tasks = artifact.timelineDefinition.tasks;
    const target = tasks.find((t) => t.dependencies.length > 0 && t.id !== artifact.timelineDefinition.serveTaskId);
    expect(target).toBeDefined();
    if (!target) return;
    const preheat = tasks.find((t) => t.id === target.dependencies[0]);
    if (!preheat) return;
    preheat.equipmentEvent = "oven-on";
    target.scheduling.waits = [600];
    const adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks.find((t) => t.id === target.id);
    for (const wait of adapted?.scheduling.waits ?? []) {
      expect(wait.minWaitSeconds).toBe(wait.taskId === preheat.id ? 600 : 0);
    }
  });

  it("turns checkpoints into one check at the range's low end, else the task's end", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks[0];
    task.minutes = 12;
    task.range = { low: 10, high: 12 };
    task.checkpoints = ["Bubbles at the edge.", "Smells toasty."];
    let adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.range).toEqual({ min: 10, max: 12 });
    expect(adapted.checkpoints).toEqual([{ afterMinutes: 10, label: "Bubbles at the edge. Smells toasty." }]);
    task.range = { low: 10, high: 14 };
    adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.range).toBeUndefined();
    expect(adapted.checkpoints).toEqual([{ afterMinutes: 12, label: "Bubbles at the edge. Smells toasty." }]);
  });

  it("shows the why line with tips and hides it in Essentials", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks[0];
    task.why = "Toasting deepens the flavor.";
    const adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.description).toBe(`${task.description.trim()} Toasting deepens the flavor.`);
    expect(adapted.instructionParts).toEqual([
      { kind: "essential", text: task.description.trim() },
      { kind: "explanation", text: " Toasting deepens the flavor." },
    ]);
  });

  it("adds a kitchen lane for serving when the timeline has none", () => {
    const artifact = clone(base);
    const timeline = artifact.timelineDefinition;
    const kitchenIds = timeline.lanes.filter((lane) => lane.kind === "kitchen").map((lane) => lane.id);
    const firstComponent = timeline.lanes.find((lane) => lane.kind === "component");
    if (!firstComponent) return;
    timeline.lanes = timeline.lanes.filter((lane) => lane.kind !== "kitchen");
    for (const task of timeline.tasks) {
      task.laneIds = task.laneIds.filter((id) => !kitchenIds.includes(id));
      if (task.laneIds.length === 0) task.laneIds = [firstComponent.id];
    }
    const input = adaptArtifactForCookingPilot(artifact);
    expect(input.timelineDefinition.lanes.at(-1)).toMatchObject({ id: "kitchen", kind: "kitchen" });
    const serve = input.timelineDefinition.tasks.find((t) => t.id === timeline.serveTaskId);
    expect(serve?.laneIds).toEqual(["kitchen"]);
    expect(() => buildCookingPlan(input.timelineDefinition)).not.toThrow();
  });

  it("returns null when the artifact cannot be shown, so the page falls back", () => {
    const artifact = clone(base);
    artifact.timelineDefinition.serveTaskId = "missing";
    expect(cookingPilotInput(artifact)).toBeNull();
  });

  it("supports a long simmer up to the open format's 12 hours", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks.find((t) => t.attention === "unattended") ?? artifact.timelineDefinition.tasks[0];
    task.minutes = 240;
    task.range = null;
    expect(() => buildCookingPlan(adaptArtifactForCookingPilot(artifact).timelineDefinition)).not.toThrow();
  });

  it("starts a fresh cook when an adjustment changes the artifact", () => {
    const scaled = clone(base);
    scaled.recipe.servings = 4;
    expect(artifactFingerprint(scaled)).not.toBe(artifactFingerprint(base));
    expect(adaptArtifactForCookingPilot(scaled).timelineDefinition.servings).toBe(4);
  });
});

describe("the finished page's Cook Along body", () => {
  const noop = () => undefined;

  it("shows the Cook Along view in place of the open sections", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactViewer, { artifact: fixtureArtifact("toasted-oat-porridge"), onStartOver: noop }),
    );
    expect(html).toContain('aria-label="Cook Along"');
    expect(html).toContain("Read this First");
    expect(html).toContain("Your kitchen, ready.");
    expect(html).not.toContain("<h3>Timeline</h3>");
    // The header parts and the action row stay.
    expect(html).toContain("Toasted Oat Porridge with Brown Butter Apples");
    expect(html).toContain("Convert another recipe");
  });

  it("keeps the header parts and notes above the Cook Along view, and Save below it", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactViewer, {
        artifact: fixtureArtifact("toasted-oat-porridge"),
        onStartOver: noop,
        notices: ["The page text was cut."],
      }),
    );
    const order = [
      'class="recipe-title"',
      'aria-label="Recipe credit"',
      "Adjust this recipe",
      "Notes on this conversion",
      'aria-label="Cook Along"',
      'class="btn-row save-row"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('aria-label="Before you start"');
  });

  it("falls back to the open sections when the view cannot show the artifact", () => {
    const artifact = clone(fixtureArtifact("toasted-oat-porridge"));
    // A dependency cycle: the open schedule and the view both refuse it.
    const [first, second] = artifact.timelineDefinition.tasks;
    first.dependencies = [second.id];
    second.dependencies = [first.id];
    const html = renderToStaticMarkup(createElement(ArtifactViewer, { artifact, onStartOver: noop }));
    expect(html).not.toContain('aria-label="Cook Along"');
    expect(html).toContain("<h3>Timeline</h3>");
  });
});

describe("/cook-along-demo", () => {
  it("serves the committed fixture artifact, current with the fixture", () => {
    const committed = JSON.parse(readFileSync("src/app/cook-along-demo/artifact.json", "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(fixtureArtifact("toasted-oat-porridge"))));
    expect(cookingPilotInput(CookAlongArtifactSchema.parse(committed))).not.toBeNull();
  });
});
