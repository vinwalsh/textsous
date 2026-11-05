import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import {
  conversionStageIndex,
  initialConversionState,
  reduceConversion,
  runConversion,
  type ConversionAction,
  type ConversionState,
  type ConvertBody,
} from "../src/app/conversion";
import DemoPage from "../src/app/demo/page";
import ProgressiveView from "../src/app/ProgressiveView";
import { sectionStates, type SectionKey, type SectionPhase } from "../src/app/section-states";
import SimulatePage from "../src/app/simulate/page";
import {
  CORNBREAD_PAGES,
  cornbreadPhoto,
  cornbreadRecording,
  muffinsArtifact,
  muffinsRecording,
  MUFFINS_URL,
  TRANSCRIBE_SECONDS,
} from "../src/app/simulate/recordings";
import {
  ADJUST_NOTE,
  clockElapsed,
  eventsBy,
  GLASSES_SPEEDS,
  idleClock,
  msUntil,
  parseRecording,
  parseSpeed,
  pauseClock,
  playClock,
  recordingDuration,
  REPLAY_SPEEDS,
  replayLabel,
  ReplayPlayer,
  replaySource,
  SIMULATION_NOTE,
  withSpeed,
  type Recording,
} from "../src/app/simulate/replay";
import ReplayBar from "../src/app/simulate/ReplayBar";
import ReplayConvert from "../src/app/simulate/ReplayConvert";
import ReplayGlasses from "../src/app/simulate/ReplayGlasses";
import ReplayPhoto from "../src/app/simulate/ReplayPhoto";
import { GUIDE_IDLE, guideNow } from "../src/lib/glasses";

const muffins = muffinsRecording();
const cornbread = cornbreadRecording();

/** The app router a client component expects to find ("Convert another recipe" leaves the replay). */
const stubRouter = {
  push() {},
  replace() {},
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

function withRouter(element: ReactElement): ReactElement {
  return createElement(AppRouterContext.Provider, { value: stubRouter }, element);
}

/** The live reducer over the events that had arrived `seconds` in. */
function stateAt(recording: Recording, body: ConvertBody, seconds: number): ConversionState {
  const actions: ConversionAction[] = [{ type: "start", body }, ...eventsBy(recording, seconds)];
  return actions.reduce(reduceConversion, initialConversionState);
}

function phases(state: ConversionState): Record<SectionKey, SectionPhase> {
  const sections = sectionStates(state);
  return Object.fromEntries(Object.entries(sections).map(([key, s]) => [key, s.phase])) as Record<
    SectionKey,
    SectionPhase
  >;
}

describe("the recordings", () => {
  it("are the five events of each real conversion, in the order and at the seconds they arrived", () => {
    expect(muffins.map((e) => [e.at, e.event.type])).toEqual([
      [0.2, "facts"],
      [4.2, "overview"],
      [24.1, "recipe"],
      [48.2, "procedure"],
      [73.8, "done"],
    ]);
    expect(cornbread.map((e) => [e.at, e.event.type])).toEqual([
      [1.6, "facts"],
      [1.6, "recipe"],
      [8.1, "overview"],
      [19.5, "procedure"],
      [46.3, "done"],
    ]);
    expect(recordingDuration(muffins)).toBe(73.8);
    expect(recordingDuration(cornbread)).toBe(46.3);
  });

  it("reduce to a finished, valid cook along of the recipe they recorded", () => {
    const done = stateAt(muffins, { url: MUFFINS_URL }, 74);
    expect(done.status).toBe("done");
    expect(done.artifact?.recipe.title).toBe("Lemon Blueberry Muffins");
    expect(done.artifact?.recipe.credit.url).toBe(MUFFINS_URL);
    expect(done.facts?.source.url).toBe(MUFFINS_URL);
    expect(done.overview?.summary).toBeTruthy();
    expect(done.timeline?.tasks.length).toBeGreaterThan(0);
    expect(done.cached).toBe(false);

    const photo = cornbreadPhoto();
    const cornbreadDone = stateAt(cornbread, { recipe: photo.recipe }, 47);
    expect(cornbreadDone.status).toBe("done");
    expect(cornbreadDone.artifact?.recipe.title).toBe("Skillet Cornbread with Honey Butter");
    expect(cornbreadDone.artifact?.recipe.credit.kind).toBe("photo");
    // The real review flagged the step order: the replay keeps the note.
    expect(cornbreadDone.notices.join(" ")).toContain("order of the steps");
  });

  it("carry the real photo answer and its two pages", () => {
    const photo = cornbreadPhoto();
    expect(photo.recipe.title).toBe("Skillet Cornbread with Honey Butter");
    expect(photo.recipe.nativeServings).toBe(8);
    expect(photo.transcription.text).toContain("SKILLET CORNBREAD WITH HONEY BUTTER");
    expect(photo.transcription.book).toBeNull();
    expect(CORNBREAD_PAGES).toHaveLength(2);
    for (const page of CORNBREAD_PAGES) {
      expect(existsSync(join(process.cwd(), "public", page.url))).toBe(true);
    }
    expect(muffinsArtifact().recipe.title).toBe("Lemon Blueberry Muffins");
    expect(TRANSCRIBE_SECONDS).toBe(20);
  });

  it("refuse a shape the live page could not play", () => {
    const done = muffins[muffins.length - 1];
    expect(() => parseRecording([])).toThrow(/non-empty/);
    expect(() => parseRecording([{ at: 5, event: done.event }, { at: 1, event: done.event }])).toThrow(/before/);
    expect(() => parseRecording([muffins[0]])).toThrow(/ends with done/);
    expect(() => parseRecording([{ at: 0, event: { type: "later" } }])).toThrow(/not a conversion event/);
    expect(() => parseRecording([{ at: -1, event: done.event }])).toThrow(/non-negative/);
  });
});

describe("a replay through the live reducer", () => {
  it("shows the sections the live page shows at each recorded second", () => {
    const body = { url: MUFFINS_URL };
    const at = (seconds: number) => stateAt(muffins, body, seconds);

    expect(phases(at(0))).toMatchObject({ facts: "working", overview: "coming", ingredients: "coming", timeline: "coming" });
    expect(conversionStageIndex(at(0))).toBe(0);

    expect(phases(at(0.2))).toMatchObject({ facts: "ready", overview: "working", ingredients: "working", before: "working" });
    expect(conversionStageIndex(at(0.2))).toBe(1);

    expect(phases(at(4.2))).toMatchObject({ facts: "ready", overview: "ready", adjust: "coming", prep: "coming" });
    expect(conversionStageIndex(at(4.2))).toBe(2);

    expect(phases(at(24.1))).toMatchObject({ adjust: "ready", ingredients: "ready", before: "working", prep: "working", steps: "working" });
    expect(conversionStageIndex(at(24.1))).toBe(3);

    expect(phases(at(48.2))).toMatchObject({ before: "ready", prep: "checking", steps: "checking", timeline: "working" });
    expect(conversionStageIndex(at(48.2))).toBe(4);

    const done = at(73.8);
    expect(done.status).toBe("done");
    expect(Object.values(phases(done)).every((phase) => phase === "ready")).toBe(true);
    expect(conversionStageIndex(done)).toBe(5);
  });

  it("brings the facts and the ingredients together on the photo conversion", () => {
    const body = { recipe: cornbreadPhoto().recipe };
    // A confirmed recipe is known before the server answers: its facts show at once.
    expect(phases(stateAt(cornbread, body, 0))).toMatchObject({ facts: "ready", ingredients: "ready", overview: "working" });
    expect(phases(stateAt(cornbread, body, 8.1))).toMatchObject({ overview: "ready", prep: "working" });
    expect(phases(stateAt(cornbread, body, 19.5))).toMatchObject({ prep: "checking", timeline: "working" });
    expect(stateAt(cornbread, body, 46.3).status).toBe("done");
  });
});

describe("the replay clock", () => {
  it("counts virtual seconds at its speed, banks them on pause, and keeps them across a speed change", () => {
    const idle = idleClock(4);
    expect(clockElapsed(idle, 5_000)).toBe(0);
    const running = playClock(idle, 1_000);
    expect(clockElapsed(running, 3_000)).toBe(8);
    const paused = pauseClock(running, 3_000);
    expect(paused).toEqual({ speed: 4, elapsed: 8, startedAt: null });
    expect(clockElapsed(paused, 9_000)).toBe(8);
    const faster = withSpeed(running, 16, 3_000);
    expect(faster).toEqual({ speed: 16, elapsed: 8, startedAt: 3_000 });
    expect(clockElapsed(faster, 4_000)).toBe(24);
    expect(withSpeed(paused, 2, 9_000)).toEqual({ speed: 2, elapsed: 8, startedAt: null });
    expect(playClock(running, 2_000)).toBe(running);
    expect(pauseClock(paused, 2_000)).toBe(paused);
  });

  it("knows how long until a recorded second comes", () => {
    const running = playClock(idleClock(4), 1_000);
    expect(msUntil(running, 24.1, 1_000)).toBeCloseTo(6_025);
    expect(msUntil(running, 8, 3_000)).toBe(0);
    expect(msUntil(pauseClock(running, 3_000), 24.1, 9_000)).toBeNull();
  });

  it("labels the bar and reads the speed from the address", () => {
    expect(replayLabel(4, 48.3, 73.8)).toBe("Replay ×4 · real time 0:48 / 1:14");
    expect(replayLabel(16, 90, 73.8)).toBe("Replay ×16 · real time 1:14 / 1:14");
    expect(replayLabel(4, 73.7, 73.8)).toBe("Replay ×4 · real time 1:13 / 1:14");
    expect(replayLabel(4, 0, 20)).toBe("Replay ×4 · real time 0:00 / 0:20");
    expect(parseSpeed("8", REPLAY_SPEEDS, 4)).toBe(8);
    expect(parseSpeed(["16"], REPLAY_SPEEDS, 4)).toBe(16);
    expect(parseSpeed("3", REPLAY_SPEEDS, 4)).toBe(4);
    expect(parseSpeed(undefined, REPLAY_SPEEDS, 4)).toBe(4);
    expect(parseSpeed("20", GLASSES_SPEEDS, 20)).toBe(20);
    expect(parseSpeed("7", GLASSES_SPEEDS, 20)).toBe(20);
  });
});

describe("the replay player as an event source", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("feeds runConversion the recording at ×16, holds the next event while paused, and reaches done", async () => {
    vi.useFakeTimers();
    const player = new ReplayPlayer(16);
    const seen: string[] = [];
    const run = runConversion({ url: MUFFINS_URL }, (action) => seen.push(action.type), {
      source: replaySource(muffins, player),
    });
    // 1 s real = 16 s virtual: the facts and the overview, not yet the recipe (24.1 s).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toEqual(["start", "facts", "overview"]);
    player.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual(["start", "facts", "overview"]);
    player.play();
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual(["start", "facts", "overview", "recipe"]);
    await vi.advanceTimersByTimeAsync(4_000);
    const final = await run;
    expect(seen).toEqual(["start", "facts", "overview", "recipe", "procedure", "done"]);
    expect(final.status).toBe("done");
    expect(final.artifact?.recipe.title).toBe("Lemon Blueberry Muffins");
  });

  it("stops without failing when the page restarts it", async () => {
    vi.useFakeTimers();
    const player = new ReplayPlayer(16);
    const controller = new AbortController();
    const seen: string[] = [];
    const run = runConversion({ url: MUFFINS_URL }, (action) => seen.push(action.type), {
      source: replaySource(muffins, player),
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const final = await run;
    expect(final.status).toBe("working");
    expect(seen).toEqual(["start", "facts", "overview"]);
  });

  it("restarts from 0:00 at the same speed", () => {
    vi.useFakeTimers();
    const player = new ReplayPlayer(4);
    vi.advanceTimersByTime(2_000);
    expect(player.elapsed()).toBe(8);
    player.setSpeed(8);
    player.restart();
    expect(player.elapsed()).toBe(0);
    expect(player.speed).toBe(8);
    expect(player.playing).toBe(true);
  });
});

describe("the simulation pages", () => {
  it("say what they are and link the three replays from the index, which /demo links", () => {
    const index = renderToStaticMarkup(createElement(SimulatePage));
    expect(index).toContain(SIMULATION_NOTE);
    expect(index).toContain('href="/simulate/convert?speed=4"');
    expect(index).toContain('href="/simulate/glasses?speed=20"');
    expect(index).toContain('href="/simulate/photo?speed=4"');
    expect(renderToStaticMarkup(createElement(DemoPage))).toContain('href="/simulate"');
  });

  it("open the conversion replay with the note and the bar at 0:00 of 1:14", () => {
    const html = renderToStaticMarkup(withRouter(createElement(ReplayConvert, { speed: 4 })));
    expect(html).toContain(SIMULATION_NOTE);
    expect(html).toContain("Replay ×4 · real time 0:00 / 1:14");
    expect(html).toContain(">Pause<");
    expect(html).toContain(">Restart<");
    expect(html).toContain('aria-pressed="true"');
  });

  it("open the photo replay on the two pages, transcribing", () => {
    const html = renderToStaticMarkup(createElement(ReplayPhoto, { speed: 4 }));
    expect(html).toContain(SIMULATION_NOTE);
    expect(html).toContain("Transcribing… (replay)");
    expect(html).toContain('src="/simulate/cornbread-page-1.jpg"');
    expect(html).toContain('src="/simulate/cornbread-page-2.jpg"');
    expect(html).toContain("Replay ×4 · real time 0:00 / 0:20");
  });

  it("open the glasses replay on the finished muffins with the badge and the timers note", () => {
    const html = renderToStaticMarkup(createElement(ReplayGlasses, { speed: 20 }));
    expect(html).toContain("ts-glasses-root");
    expect(html).toContain('<span class="g-badge">Replay ×20</span>');
    expect(html).toContain("Timers run in real time");
    expect(html).toContain(SIMULATION_NOTE);
    expect(html).toContain("Start guide");
  });

  it("show the bar's speeds with the current one pressed", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayBar, {
        speed: 8,
        elapsed: 48.3,
        total: 73.8,
        playing: false,
        onToggle: () => {},
        onSpeed: () => {},
        onRestart: () => {},
      }),
    );
    expect(html).toContain("Replay ×8 · real time 0:48 / 1:14");
    expect(html).toContain(">Play<");
    expect(html).toMatch(/class="btn btn-primary" aria-pressed="true"[^>]*>×8</);
    expect(html).toMatch(/class="btn" aria-pressed="false"[^>]*>×4</);
  });
});

describe("Apply on a replay", () => {
  it("is off with its note on the progressive view and on the finished page", () => {
    const working = stateAt(muffins, { url: MUFFINS_URL }, 30);
    const progressive = renderToStaticMarkup(
      createElement(ProgressiveView, { state: working, queued: null, onQueue: () => {}, adjustNote: ADJUST_NOTE }),
    );
    expect(progressive).toMatch(/<button type="submit" class="btn btn-primary" disabled="">Apply when ready</);
    expect(progressive).toContain(ADJUST_NOTE);

    const finished = renderToStaticMarkup(
      createElement(ArtifactViewer, {
        artifact: muffinsArtifact(),
        onStartOver: () => {},
        adjustNote: ADJUST_NOTE,
        cookAlongView: false,
      }),
    );
    expect(finished).toMatch(/<button type="submit" class="btn btn-primary" disabled="">Apply adjustments</);
    expect(finished).toContain(ADJUST_NOTE);

    const live = renderToStaticMarkup(
      createElement(ProgressiveView, { state: working, queued: null, onQueue: () => {} }),
    );
    expect(live).not.toContain(ADJUST_NOTE);
  });
});

describe("the glasses guide clock on a replay", () => {
  it("runs ahead of the wall clock by the multiplier while the guide runs, never for timers", () => {
    expect(guideNow(GUIDE_IDLE, 5_000, 20)).toBe(5_000);
    expect(guideNow({ elapsedMs: 0, startedAt: 1_000 }, 2_000, 1)).toBe(2_000);
    expect(guideNow({ elapsedMs: 0, startedAt: 1_000 }, 2_000, 20)).toBe(21_000);
    expect(guideNow({ elapsedMs: 60_000, startedAt: null }, 2_000, 20)).toBe(2_000);
  });
});
