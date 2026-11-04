import { describe, expect, it } from "vitest";
import { glassesDemos, slugTitle, EMBED_DEMO_POST_URL } from "../src/app/glasses/demos";
import {
  arrowDirection,
  dueIndex,
  formatCountdown,
  formatElapsed,
  glassesArtifactSrc,
  glassesInstallLink,
  glassesRecipeUrl,
  glassesRequestFromSearch,
  glassesStorageKey,
  GUIDE_IDLE,
  guideElapsedMs,
  hudOrder,
  laneName,
  newlyDone,
  parseSaved,
  pauseGuide,
  spatialTarget,
  startGuide,
  taskHeading,
  taskIngredientLines,
  taskTimerMs,
  timerRemainingMs,
  timersReducer,
  type TaskTimer,
} from "../src/lib/glasses";
import { schedule } from "../src/lib/scheduler/schedule";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const MIN = 60_000;

describe("task order by schedule", () => {
  const artifact = fixtureArtifact();
  const timeline = artifact.timelineDefinition;

  it("lists every task once, by start minute, with the schedule's total", () => {
    const { tasks, totalMinutes } = hudOrder(timeline);
    expect(tasks.map((t) => t.task.id).sort()).toEqual(timeline.tasks.map((t) => t.id).sort());
    const starts = tasks.map((t) => t.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(totalMinutes).toBe(schedule(timeline).totalMinutes);
    expect(tasks[0].task.phase).toBe("prep");
    expect(tasks[tasks.length - 1].task.id).toBe(timeline.serveTaskId);
  });

  it("falls back to timeline order, back to back, when the schedule can't be computed", () => {
    const broken = {
      ...timeline,
      tasks: timeline.tasks.map((t, i) => (i === 0 ? { ...t, dependencies: [t.id] } : t)),
    };
    const { tasks, totalMinutes } = hudOrder(broken);
    expect(tasks.map((t) => t.task.id)).toEqual(timeline.tasks.map((t) => t.id));
    expect(tasks[1].start).toBe(timeline.tasks[0].minutes);
    expect(totalMinutes).toBe(timeline.tasks.reduce((n, t) => n + t.minutes, 0));
  });
});

describe("which task is due at a guide minute", () => {
  const tasks = [{ start: 0 }, { start: 0 }, { start: 3 }, { start: 3 }, { start: 10 }];

  it("is the first task with the latest start that has come", () => {
    expect(dueIndex(tasks, 0)).toBe(0);
    expect(dueIndex(tasks, 2)).toBe(0);
    expect(dueIndex(tasks, 3)).toBe(2);
    expect(dueIndex(tasks, 9)).toBe(2);
    expect(dueIndex(tasks, 10)).toBe(4);
    expect(dueIndex(tasks, 500)).toBe(4);
  });

  it("is the first task before anything starts", () => {
    expect(dueIndex([{ start: 2 }, { start: 5 }], 0)).toBe(0);
  });
});

describe("guide clock", () => {
  it("counts while running and holds while paused", () => {
    const started = startGuide(GUIDE_IDLE, 1_000);
    expect(guideElapsedMs(started, 61_000)).toBe(MIN);
    const paused = pauseGuide(started, 61_000);
    expect(paused.startedAt).toBeNull();
    expect(guideElapsedMs(paused, 999_000)).toBe(MIN);
    const resumed = startGuide(paused, 100_000);
    expect(guideElapsedMs(resumed, 130_000)).toBe(90_000);
  });

  it("can start from a task's minute, and starting twice changes nothing", () => {
    const fromFive = startGuide(GUIDE_IDLE, 0, 5);
    expect(guideElapsedMs(fromFive, 0)).toBe(5 * MIN);
    expect(startGuide(fromFive, 50_000, 9)).toBe(fromFive);
    expect(pauseGuide(GUIDE_IDLE, 10)).toBe(GUIDE_IDLE);
  });
});

describe("task timers", () => {
  const start = (state: TaskTimer[], taskId: string, minutes: number, now: number) =>
    timersReducer(state, { type: "start", taskId, durationMs: minutes * MIN, now });

  it("starts, pauses, resumes and stops one task's countdown", () => {
    let s = start([], "simmer", 10, 0);
    expect(s).toEqual([{ taskId: "simmer", status: "running", endsAt: 10 * MIN, remainingMs: 10 * MIN }]);
    s = timersReducer(s, { type: "pause", taskId: "simmer", now: 4 * MIN });
    expect(s[0]).toMatchObject({ status: "paused", endsAt: null, remainingMs: 6 * MIN });
    expect(timerRemainingMs(s[0], 99 * MIN)).toBe(6 * MIN);
    s = timersReducer(s, { type: "resume", taskId: "simmer", now: 20 * MIN });
    expect(s[0]).toMatchObject({ status: "running", endsAt: 26 * MIN });
    expect(timersReducer(s, { type: "stop", taskId: "simmer" })).toEqual([]);
  });

  it("adjusts by a minute either way and never below zero", () => {
    let s = start([], "roast", 2, 0);
    s = timersReducer(s, { type: "adjust", taskId: "roast", deltaMs: MIN, now: 0 });
    expect(timerRemainingMs(s[0], 0)).toBe(3 * MIN);
    s = timersReducer(s, { type: "pause", taskId: "roast", now: 2.5 * MIN });
    s = timersReducer(s, { type: "adjust", taskId: "roast", deltaMs: -MIN, now: 2.5 * MIN });
    expect(s[0]).toMatchObject({ status: "paused", remainingMs: 0 });
    s = timersReducer(s, { type: "resume", taskId: "roast", now: 3 * MIN });
    s = timersReducer(s, { type: "adjust", taskId: "roast", deltaMs: MIN, now: 3 * MIN });
    s = timersReducer(s, { type: "adjust", taskId: "roast", deltaMs: -MIN, now: 3.5 * MIN });
    expect(s[0]).toMatchObject({ status: "done", remainingMs: 0, endsAt: null });
  });

  it("marks timers done on the tick after they end, and a minute more restarts one", () => {
    let s = start(start([], "simmer", 30, 0), "roast", 12, 0);
    const before = s;
    s = timersReducer(s, { type: "tick", now: 11 * MIN });
    expect(s).toBe(before);
    s = timersReducer(s, { type: "tick", now: 12 * MIN });
    expect(s.map((t) => t.status)).toEqual(["running", "done"]);
    expect(newlyDone(before, s)).toEqual(["roast"]);
    expect(newlyDone(s, s)).toEqual([]);
    s = timersReducer(s, { type: "adjust", taskId: "roast", deltaMs: MIN, now: 13 * MIN });
    expect(s[1]).toMatchObject({ status: "running", endsAt: 14 * MIN });
  });

  it("runs several timers at once; starting a running one does nothing, a done one starts again", () => {
    let s = start(start([], "simmer", 240, 0), "roast", 45, 0);
    expect(s.map((t) => t.taskId)).toEqual(["simmer", "roast"]);
    expect(start(s, "simmer", 5, 10)).toBe(s);
    s = timersReducer(s, { type: "tick", now: 45 * MIN });
    s = start(s, "roast", 45, 50 * MIN);
    expect(s[1]).toMatchObject({ status: "running", endsAt: 95 * MIN });
  });

  it("uses the task's minutes, or the high end of its range", () => {
    expect(taskTimerMs({ minutes: 25, range: null })).toBe(25 * MIN);
    expect(taskTimerMs({ minutes: 20, range: { low: 18, high: 24 } })).toBe(24 * MIN);
  });
});

describe("clock text", () => {
  it("reads m:ss under an hour and h:mm:ss from an hour up", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(750_000)).toBe("12:30");
    expect(formatCountdown(59_001)).toBe("1:00");
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown((3 * 3600 + 42 * 60 + 10) * 1000)).toBe("3:42:10");
    expect(formatElapsed(61_900)).toBe("1:01");
    expect(formatElapsed(4 * 3600 * 1000)).toBe("4:00:00");
  });
});

describe("task text", () => {
  const artifact = fixtureArtifact();
  const simmer = artifact.timelineDefinition.tasks.find((t) => t.id === "task-simmer-porridge");

  it("names the task by its card and lane", () => {
    expect(simmer).toBeDefined();
    if (!simmer) return;
    expect(taskHeading(simmer)).toBe("Simmer porridge");
    expect(laneName(simmer, artifact.timelineDefinition.lanes)).toBe("Porridge Base");
  });

  it("lists the task's ingredients with amounts, the cook's amount first", () => {
    if (!simmer) return;
    const lines = taskIngredientLines(simmer, artifact.recipe.ingredients);
    expect(lines.length).toBe(simmer.scheduling.ingredientIds.length);
    expect(lines.some((line) => /milk/.test(line) && /2 cups/.test(line))).toBe(true);
    const scaled = artifact.recipe.ingredients.map((ing) =>
      /milk/.test(ing.name) ? { ...ing, cookQuantity: "3" } : ing,
    );
    expect(taskIngredientLines(simmer, scaled).some((line) => line.startsWith("3 cups"))).toBe(true);
    expect(
      taskIngredientLines({ scheduling: { waits: [], resourceIds: [], ingredientIds: ["nope"] } }, scaled),
    ).toEqual([]);
  });
});

describe("saved state", () => {
  const ids = new Set(["a", "b"]);

  it("round-trips and keeps only timers on this cook along's tasks", () => {
    const saved = {
      v: 1,
      currentTaskId: "b",
      guide: { elapsedMs: 5000, startedAt: 100 },
      timers: [
        { taskId: "a", status: "running", endsAt: 9000, remainingMs: 9000 },
        { taskId: "gone", status: "paused", endsAt: null, remainingMs: 10 },
        { taskId: "b", status: "running", endsAt: null, remainingMs: 10 },
      ],
    };
    expect(parseSaved(JSON.stringify(saved), ids)).toEqual({
      v: 1,
      currentTaskId: "b",
      guide: { elapsedMs: 5000, startedAt: 100 },
      timers: [{ taskId: "a", status: "running", endsAt: 9000, remainingMs: 9000 }],
    });
  });

  it("ignores anything unreadable", () => {
    expect(parseSaved(null, ids)).toBeNull();
    expect(parseSaved("{", ids)).toBeNull();
    expect(parseSaved(JSON.stringify({ v: 2 }), ids)).toBeNull();
    expect(parseSaved(JSON.stringify({ v: 1, guide: { elapsedMs: 0 }, currentTaskId: "zz" }), ids)).toEqual({
      v: 1,
      currentTaskId: null,
      guide: { elapsedMs: 0, startedAt: null },
      timers: [],
    });
  });

  it("is kept per artifact", () => {
    expect(glassesStorageKey("art-1")).toBe("textsous:glasses:art-1");
  });
});

describe("links", () => {
  const id = "0f1e2d3c-4b5a-4968-8776-655443322110";
  const sig = "a".repeat(64);

  it("builds the Meta AI app's web app link", () => {
    expect(glassesInstallLink("https://open.textsous.com/glasses?src=x&y=1")).toBe(
      "fb-viewapp://web_app_deep_link?appName=TextSous%20Cook%20Along&appUrl=https%3A%2F%2Fopen.textsous.com%2Fglasses%3Fsrc%3Dx%26y%3D1",
    );
  });

  it("accepts only this site's signed artifact links over https", () => {
    const origin = "https://open.textsous.com";
    const good = `${origin}/api/artifact/${id}?sig=${sig}`;
    expect(glassesArtifactSrc(good, origin)).toBe(good);
    expect(glassesArtifactSrc(`/api/artifact/${id}?sig=${sig}`, origin)).toBe(good);
    expect(glassesArtifactSrc(`https://evil.test/api/artifact/${id}?sig=${sig}`, origin)).toBeNull();
    expect(glassesArtifactSrc(`http://open.textsous.com/api/artifact/${id}?sig=${sig}`, origin)).toBeNull();
    expect(glassesArtifactSrc(`${origin}/api/artifact/${id}`, origin)).toBeNull();
    expect(glassesArtifactSrc(`${origin}/api/artifact/${id}?sig=abc`, origin)).toBeNull();
    expect(glassesArtifactSrc(`${origin}/api/health?sig=${sig}`, origin)).toBeNull();
    expect(glassesArtifactSrc("javascript:alert(1)", origin)).toBeNull();
    expect(glassesArtifactSrc(`http://localhost:3000/api/artifact/${id}?sig=${sig}`, "http://localhost:3000")).toBe(
      `http://localhost:3000/api/artifact/${id}?sig=${sig}`,
    );
  });

  it("reads ?src= before ?url= from the query string", () => {
    expect(glassesRequestFromSearch("")).toEqual({ kind: "none" });
    expect(glassesRequestFromSearch("?url=https%3A%2F%2Fexample.com%2Fsoup")).toEqual({
      kind: "url",
      url: "https://example.com/soup",
    });
    expect(glassesRequestFromSearch("?url=https%3A%2F%2Fexample.com&src=%2Fapi%2Fartifact%2Fx")).toEqual({
      kind: "src",
      src: "/api/artifact/x",
    });
  });

  it("accepts only http(s) recipe pages", () => {
    expect(glassesRecipeUrl(" https://example.com/soup ")).toBe("https://example.com/soup");
    expect(glassesRecipeUrl("javascript:alert(1)")).toBeNull();
    expect(glassesRecipeUrl("soup")).toBeNull();
  });
});

describe("D-pad navigation", () => {
  // Five buttons in a row under three timer buttons.
  const row = [0, 1, 2, 3, 4].map((i) => ({ x: i * 110, y: 500, w: 100, h: 56 }));
  const above = [0, 1, 2].map((i) => ({ x: i * 180, y: 430, w: 170, h: 56 }));
  const boxes = [...row, ...above];

  it("moves along a row and stops at its ends", () => {
    expect(spatialTarget(boxes, 0, "right")).toBe(1);
    expect(spatialTarget(boxes, 1, "left")).toBe(0);
    expect(spatialTarget(boxes, 0, "left")).toBeNull();
    expect(spatialTarget(boxes, 4, "right")).toBeNull();
    expect(spatialTarget(boxes, 0, "down")).toBeNull();
  });

  it("moves up to the nearest control in line", () => {
    expect(spatialTarget(boxes, 0, "up")).toBe(5);
    expect(spatialTarget(boxes, 4, "up")).toBe(7);
    expect(spatialTarget(boxes, 6, "down")).toBe(2);
  });

  it("maps arrow keys", () => {
    expect(arrowDirection("ArrowLeft")).toBe("left");
    expect(arrowDirection("ArrowDown")).toBe("down");
    expect(arrowDirection("Enter")).toBeNull();
  });
});

describe("picker", () => {
  it("lists the demo recipes by readable title, then the demo post", () => {
    const demos = glassesDemos([
      "https://cooking.nytimes.com/recipes/1019627-sheet-pan-chicken?art=1",
      "https://www.example.com/2026/10/skillet-pierogi/",
    ]);
    expect(demos).toEqual([
      {
        url: "https://cooking.nytimes.com/recipes/1019627-sheet-pan-chicken?art=1",
        host: "cooking.nytimes.com",
        title: "Sheet pan chicken",
      },
      { url: "https://www.example.com/2026/10/skillet-pierogi/", host: "example.com", title: "Skillet pierogi" },
      {
        url: EMBED_DEMO_POST_URL,
        host: "open.textsous.com",
        title: "Toasted Oat Porridge with Brown Butter Apples",
      },
    ]);
    expect(slugTitle("https://example.com/")).toBe("example.com");
  });

  it("reads all 20 demo recipes from eval/urls.txt", () => {
    expect(glassesDemos()).toHaveLength(21);
  });
});
