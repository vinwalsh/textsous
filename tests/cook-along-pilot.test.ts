import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import DemoPage from "../src/app/demo/page";
import { CookingPilot } from "../src/components/cooking-pilot/cooking-pilot";
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
      // A range runs to its high end, like the view's own source ranges.
      const ranged = open.range && open.range.low < open.range.high ? open.range : null;
      expect(task.minutes).toBe(ranged ? ranged.high : open.minutes);
      expect(task.range).toEqual(ranged ? { min: ranged.low, max: ranged.high } : undefined);
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

  it("is ready for the view (cookingPilotInput), with the view's time to serve", () => {
    const ready = cookingPilotInput(artifact);
    expect(ready).not.toBeNull();
    expect(ready?.serveMinute).toBe(buildCookingPlan(definition).serveMinute);
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

  it("keeps a range: the task runs to its high end and may finish from its low end", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks[0];
    task.minutes = 12;
    task.range = { low: 10, high: 14 };
    let adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.minutes).toBe(14);
    expect(adapted.range).toEqual({ min: 10, max: 14 });
    expect(() => buildCookingPlan(adaptArtifactForCookingPilot(artifact).timelineDefinition)).not.toThrow();
    task.range = { low: 12, high: 12 };
    adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.minutes).toBe(12);
    expect(adapted.range).toBeUndefined();
  });

  it("turns checkpoints into one check at the range's low end, as sentences", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks[0];
    task.minutes = 12;
    task.range = { low: 10, high: 12 };
    task.checkpoints = ["Bubbles at the edge", "Smells toasty."];
    const adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.range).toEqual({ min: 10, max: 12 });
    expect(adapted.checkpoints).toEqual([{ afterMinutes: 10, label: "Bubbles at the edge. Smells toasty." }]);
    expect(adapted.tip ?? "").not.toContain("Watch for");
  });

  it("puts checkpoints without a range in the tip, never as a check at the task's end", () => {
    const artifact = clone(base);
    const task = artifact.timelineDefinition.tasks[0];
    task.minutes = 12;
    task.range = null;
    task.tip = "Stir now and then";
    task.checkpoints = ["Bubbles at the edge", "Smells toasty!"];
    const adapted = adaptArtifactForCookingPilot(artifact).timelineDefinition.tasks[0];
    expect(adapted.checkpoints).toBeUndefined();
    expect(adapted.tip).toBe("Stir now and then. Watch for: Bubbles at the edge. Smells toasty!");
    expect(() => buildCookingPlan(adaptArtifactForCookingPilot(artifact).timelineDefinition)).not.toThrow();
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

  it("lets the cook change estimates in Adjust Cooking Times, and an edit reschedules", () => {
    const artifact = clone(base);
    const tasks = artifact.timelineDefinition.tasks;
    const estimate = tasks.find((t) => t.timingBasis === "estimate" && t.id !== artifact.timelineDefinition.serveTaskId);
    expect(estimate).toBeDefined();
    if (!estimate) return;
    // A ranged estimate with a check, like a batch: an edit replaces both.
    estimate.range = { low: estimate.minutes, high: estimate.minutes + 4 };
    estimate.checkpoints = ["Golden at the edges"];
    const input = adaptArtifactForCookingPilot(artifact);
    const definition = input.timelineDefinition;
    expect(definition.tasks.filter((t) => t.editableMinutes).map((t) => t.id)).toEqual(
      tasks.filter((t) => t.timingBasis === "estimate").map((t) => t.id),
    );
    const before = buildCookingPlan(definition);
    const minutes = estimate.minutes + 30;
    const after = buildCookingPlan(definition, { [estimate.id]: minutes });
    const edited = after.tasks.find((t) => t.id === estimate.id);
    expect(edited?.minutes).toBe(minutes);
    expect(edited?.adjustedFromMinutes).toBe(estimate.minutes + 4);
    expect(edited?.range).toBeUndefined();
    expect(edited?.checkpoints?.every((point) => point.afterMinutes <= minutes)).toBe(true);
    expect(after.serveMinute).toBeGreaterThan(before.serveMinute);
    const source = tasks.find((t) => t.timingBasis === "source");
    if (source) expect(() => buildCookingPlan(definition, { [source.id]: source.minutes + 1 })).toThrow();
    // The list renders a row per estimate.
    const html = renderToStaticMarkup(
      createElement(CookingPilot, { embedded: true, initialTab: "overview", recipe: input.recipe, timelineDefinition: definition }),
    );
    const rows = html.match(/estimate in minutes"/g) ?? [];
    expect(rows).toHaveLength(tasks.filter((t) => t.timingBasis === "estimate").length);
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
    // It opens on the swimlanes with Cook in view; Read this First is a tab.
    expect(html).toContain('aria-label="Cooking timeline"');
    expect(html).toMatch(/<button[^>]*>(<svg[^>]*>[\s\S]*?<\/svg>)?Cook<\/button>/);
    expect(html).toContain("Read this First");
    expect(html).not.toContain("Your kitchen, ready.");
    // The view adds no second <main> inside the page.
    expect(html.match(/<main\b/g) ?? []).toHaveLength(0);
    expect(html).not.toContain("<h3>Timeline</h3>");
    // The header parts and the action row stay.
    expect(html).toContain("Toasted Oat Porridge with Brown Butter Apples");
    expect(html).toContain("Convert another recipe");
  });

  it("shows one total time: the view's time to serve in the facts line", () => {
    const artifact = clone(fixtureArtifact("toasted-oat-porridge"));
    // A range the open schedule counts low and the view counts high.
    const task = artifact.timelineDefinition.tasks.find((t) => t.phase === "cook") ?? artifact.timelineDefinition.tasks[0];
    task.range = { low: task.minutes, high: task.minutes + 20 };
    const serve = cookingPilotInput(artifact)?.serveMinute;
    expect(serve).toBeDefined();
    expect(serve).not.toBe(schedule(artifact.timelineDefinition).totalMinutes);
    const html = renderToStaticMarkup(createElement(ArtifactViewer, { artifact, onStartOver: noop }));
    expect(html).toContain(` · About ${serve} minutes`);
    expect(html).toContain(`<strong>About ${serve} min</strong>`);
    expect(html).not.toContain(`About ${schedule(artifact.timelineDefinition).totalMinutes} min`);
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
  it("is the first link on /demo", () => {
    const html = renderToStaticMarkup(createElement(DemoPage));
    const at = html.indexOf('href="/cook-along-demo"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('href="/?url='));
  });


  it("serves the committed fixture artifact, current with the fixture", () => {
    const committed = JSON.parse(readFileSync("src/app/cook-along-demo/artifact.json", "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(fixtureArtifact("toasted-oat-porridge"))));
    expect(cookingPilotInput(CookAlongArtifactSchema.parse(committed))).not.toBeNull();
  });
});
