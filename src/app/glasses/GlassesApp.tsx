"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
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
  type GlassesSaved,
  type GuideClock,
  type HudTask,
  type TaskTimer,
  type TimerAction,
} from "../../lib/glasses";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../../lib/schema/artifact";
import { apiFetch, friendlyError, type FriendlyError } from "../request";

export type GlassesRequest =
  | { kind: "none" }
  | { kind: "src"; src: string }
  | { kind: "url"; url: string };

/** One recipe in the picker: its page and how it reads in the list. */
export interface GlassesDemo {
  url: string;
  host: string;
  title: string;
}

type LoadState =
  | { kind: "boot" }
  | { kind: "pick" }
  | { kind: "loading" }
  | { kind: "error"; error: FriendlyError }
  | { kind: "ready"; artifact: CookAlongArtifact };

export function initialGlassesState(request: GlassesRequest): LoadState {
  return request.kind === "none" ? { kind: "pick" } : { kind: "loading" };
}

const VOICE_KEY = "textsous:glasses-voice";

const PHASES: Record<string, string> = { prep: "Prep", cook: "Cook", finish: "Finish" };

function readVoice(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

function storeVoice(on: boolean): void {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {
    // Blocked storage: the choice lasts for this visit.
  }
}

/** Say a line out loud when the device can; silence is always safe. */
export function speak(text: string): void {
  try {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch {
    // No voice on this device.
  }
}

/** Load the cook along from a signed link or a recipe page (cache-first). */
async function loadArtifact(request: GlassesRequest): Promise<LoadState> {
  if (request.kind === "none") return { kind: "pick" };
  if (request.kind === "src") {
    const src = glassesArtifactSrc(request.src, window.location.origin);
    if (!src) {
      return {
        kind: "error",
        error: {
          title: "That link didn't work",
          detail: "Open your cook along on open.textsous.com and choose Cook on Meta glasses again.",
        },
      };
    }
    const res = await apiFetch(src);
    if (res.status === 404) {
      return {
        kind: "error",
        error: {
          title: "That link has expired",
          detail: "Cook along links last 24 hours. Open the recipe again to get a fresh one.",
        },
      };
    }
    const valid = CookAlongArtifactSchema.safeParse(res.data);
    if (!res.ok || !valid.success) {
      return { kind: "error", error: friendlyError(res.status, "", { timeout: res.timeout }) };
    }
    return { kind: "ready", artifact: valid.data };
  }
  const url = glassesRecipeUrl(request.url);
  if (!url) {
    return {
      kind: "error",
      error: { title: "That recipe link didn't work", detail: "It needs to be a full https:// address." },
    };
  }
  const res = await apiFetch("/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = res.data as { artifact?: unknown; error?: string; reason?: string } | null;
  const valid = CookAlongArtifactSchema.safeParse(data?.artifact);
  if (!res.ok || !valid.success) {
    return {
      kind: "error",
      error: friendlyError(res.status, data?.error ?? "", {
        timeout: res.timeout,
        reason: data?.reason,
        recipeUrl: url,
      }),
    };
  }
  return { kind: "ready", artifact: valid.data };
}

/** Arrow keys move between controls like the glasses' D-pad; Escape closes Details. */
function useSpatialKeys(onEscape: () => boolean): void {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (escapeRef.current()) event.preventDefault();
        return;
      }
      const dir = arrowDirection(event.key);
      if (!dir || event.altKey || event.ctrlKey || event.metaKey) return;
      const scope = document.querySelector(".g-details") ?? document.querySelector(".ts-glasses-root");
      if (!scope) return;
      const items = Array.from(scope.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")).filter(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        },
      );
      if (items.length === 0) return;
      const from = items.indexOf(document.activeElement as HTMLElement);
      if (from === -1) {
        // Nothing focused yet: start from the main control.
        event.preventDefault();
        (items.find((el) => el.classList.contains("g-btn-main")) ?? items[0]).focus();
        return;
      }
      const boxes = items.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      const target = spatialTarget(boxes, from, dir);
      if (target === null) return;
      event.preventDefault();
      items[target].focus();
      items[target].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Heads-up Cook Along for Meta Ray-Ban Display: loads `?src=` or `?url=`,
 * else shows the picker. Everything is a real button or link, so the
 * glasses' D-pad and pinch reach it.
 */
export default function GlassesApp({
  request: given,
  demos,
}: {
  /** What to show; read from the page's query string when left out. */
  request?: GlassesRequest;
  demos: readonly GlassesDemo[];
}) {
  const [state, setState] = useState<LoadState>(() => (given ? initialGlassesState(given) : { kind: "boot" }));
  const escapeRef = useRef<() => boolean>(() => false);
  useSpatialKeys(() => escapeRef.current());

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      const request = given ?? glassesRequestFromSearch(window.location.search);
      if (request.kind === "none") {
        setState({ kind: "pick" });
        return;
      }
      setState({ kind: "loading" });
      void loadArtifact(request).then((next) => {
        if (live) setState(next);
      });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [given]);

  return (
    <div className="ts-glasses-root">
      {state.kind === "ready" ? (
        <GlassesCookAlong artifact={state.artifact} escapeRef={escapeRef} />
      ) : (
        <div className="g-screen">
          <GlassesStatus state={state} demos={demos} />
        </div>
      )}
      <InstallPanel />
    </div>
  );
}

/** Picker, loading and error screens. */
export function GlassesStatus({ state, demos }: { state: LoadState; demos: readonly GlassesDemo[] }) {
  if (state.kind === "boot") {
    return (
      <p className="g-status g-muted" role="status">
        Loading…
      </p>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="g-status" role="status">
        <p className="g-status-title">Getting your cook along ready…</p>
        <p className="g-muted">A recipe converted recently opens right away. A new one takes about a minute.</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="g-status" role="alert">
        <p className="g-status-title">{state.error.title}</p>
        <p className="g-muted">{state.error.detail}</p>
        <a className="g-btn" href="/glasses" autoFocus>
          Choose a recipe
        </a>
      </div>
    );
  }
  if (state.kind === "pick") return <GlassesPicker demos={demos} />;
  return null;
}

export function GlassesPicker({ demos }: { demos: readonly GlassesDemo[] }) {
  return (
    <nav className="g-picker" aria-label="Choose a recipe">
      <h1 className="g-picker-title">Choose a recipe</h1>
      <p className="g-muted">Pick one to cook along on your glasses.</p>
      <ul className="g-picker-list">
        {demos.map((demo, i) => (
          <li key={demo.url}>
            <a className="g-pick" href={`/glasses?url=${encodeURIComponent(demo.url)}`} autoFocus={i === 0}>
              <span className="g-pick-title">{demo.title}</span>
              <span className="g-pick-host">{demo.host}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Small label for a timer chip: the card's action ("Simmer"). */
function chipLabel(task: HudTask["task"]): string {
  return task.cardTitle.action;
}

export interface HudProps {
  artifact: CookAlongArtifact;
  order: readonly HudTask[];
  totalMinutes: number;
  current: number;
  now: number;
  guide: GuideClock;
  timers: readonly TaskTimer[];
  voice: boolean;
  announcement: string;
  flashing: ReadonlySet<string>;
  onPrev: () => void;
  onNext: () => void;
  onToggleGuide: () => void;
  onDetails: () => void;
  onTimer: (action: "start" | "pause" | "resume" | "minus" | "plus" | "stop") => void;
  onJump: (taskId: string) => void;
  onToggleVoice: () => void;
  detailsButtonRef?: Ref<HTMLButtonElement>;
  timerButtonRef?: Ref<HTMLButtonElement>;
}

/** The HUD: the task now, what's next, the guide clock, controls and running timers. Pure. */
export function GlassesHud({
  artifact,
  order,
  totalMinutes,
  current,
  now,
  guide,
  timers,
  voice,
  announcement,
  flashing,
  onPrev,
  onNext,
  onToggleGuide,
  onDetails,
  onTimer,
  onJump,
  onToggleVoice,
  detailsButtonRef,
  timerButtonRef,
}: HudProps) {
  const item = order[current];
  const task = item.task;
  const next = order[current + 1];
  const timer = timers.find((t) => t.taskId === task.id) ?? null;
  const running = guide.startedAt !== null;
  const lane = laneName(task, artifact.timelineDefinition.lanes);
  const timerButton =
    timer === null
      ? "Start timer"
      : timer.status === "running"
        ? "Pause timer"
        : timer.status === "paused"
          ? "Resume timer"
          : "Restart timer";
  const byId = new Map(order.map((o) => [o.task.id, o.task] as const));
  return (
    <section className="g-screen g-hud" aria-label="Cook along">
      <header className="g-top">
        <span className="g-step">
          Step {current + 1} of {order.length} · {PHASES[task.phase] ?? task.phase}
        </span>
        <span className={running ? "g-clock g-clock-on" : "g-clock"}>
          {formatElapsed(guideElapsedMs(guide, now))}
          <span className="g-muted"> / {totalMinutes} min</span>
        </span>
        <button type="button" className="g-voice" aria-pressed={voice} onClick={onToggleVoice}>
          {voice ? "Voice on" : "Voice off"}
        </button>
      </header>

      <div className="g-now">
        {lane ? <p className="g-lane">{lane}</p> : null}
        <h1 className="g-title">{taskHeading(task)}</h1>
        <p className="g-desc">{task.description}</p>
        {timer ? (
          <p className={`g-timer g-timer-${timer.status}`}>
            {timer.status === "done"
              ? "Timer done"
              : `${formatCountdown(timerRemainingMs(timer, now))}${timer.status === "paused" ? " paused" : " left"}`}
          </p>
        ) : (
          <p className="g-muted g-minutes">
            {task.range ? `${task.range.low}–${task.range.high}` : task.minutes} min
            {task.attention === "unattended" ? " · unattended" : ""}
            {task.timingBasis === "estimate" ? " · estimated" : ""}
          </p>
        )}
      </div>

      <p className="g-next">{next ? `Next: ${taskHeading(next.task)}` : "Last step"}</p>

      {timer ? (
        <div className="g-row g-timer-row" role="group" aria-label={`Timer for ${taskHeading(task)}`}>
          <button type="button" className="g-btn" onClick={() => onTimer("minus")} aria-label="One minute less">
            −1 min
          </button>
          <button type="button" className="g-btn" onClick={() => onTimer("plus")} aria-label="One minute more">
            +1 min
          </button>
          <button type="button" className="g-btn" onClick={() => onTimer("stop")}>
            Stop timer
          </button>
        </div>
      ) : null}

      <div className="g-row g-controls" role="group" aria-label="Controls">
        <button type="button" className="g-btn" onClick={onPrev} aria-disabled={current === 0}>
          Prev
        </button>
        <button type="button" className="g-btn g-btn-main" onClick={onToggleGuide} autoFocus>
          {running ? "Pause guide" : "Start guide"}
        </button>
        <button type="button" className="g-btn" onClick={onDetails} ref={detailsButtonRef}>
          Details
        </button>
        <button
          type="button"
          className="g-btn"
          ref={timerButtonRef}
          onClick={() =>
            onTimer(
              timer === null || timer.status === "done" ? "start" : timer.status === "running" ? "pause" : "resume",
            )
          }
        >
          {timerButton}
        </button>
        <button
          type="button"
          className="g-btn"
          onClick={onNext}
          aria-disabled={current === order.length - 1}
        >
          Next
        </button>
      </div>

      {timers.length > 0 ? (
        <div className="g-row g-chips" role="group" aria-label="Timers">
          {timers.map((t) => {
            const owner = byId.get(t.taskId);
            if (!owner) return null;
            const text =
              t.status === "done"
                ? `${chipLabel(owner)} done`
                : `${chipLabel(owner)} ${formatCountdown(timerRemainingMs(t, now))}`;
            const classes = ["g-chip", `g-chip-${t.status}`, flashing.has(t.taskId) ? "g-flash" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={t.taskId}
                type="button"
                className={classes}
                aria-current={t.taskId === task.id ? "true" : undefined}
                onClick={() => onJump(t.taskId)}
              >
                {text}
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

/** Everything about the task now: amounts, checks, the cue, tip and why. Pure. */
export function GlassesDetails({
  artifact,
  item,
  number,
  count,
  onBack,
}: {
  artifact: CookAlongArtifact;
  item: HudTask;
  number: number;
  count: number;
  onBack: () => void;
}) {
  const task = item.task;
  const ingredients = taskIngredientLines(task, artifact.recipe.ingredients);
  const lane = laneName(task, artifact.timelineDefinition.lanes);
  return (
    <section className="g-details" role="dialog" aria-modal="true" aria-label={`Details: ${taskHeading(task)}`}>
      <div className="g-row g-details-bar">
        <button type="button" className="g-btn" onClick={onBack} autoFocus>
          Back
        </button>
        <span className="g-muted">
          Step {number} of {count}
          {lane ? ` · ${lane}` : ""}
        </span>
      </div>
      <h2 className="g-details-title">{taskHeading(task)}</h2>
      <p className="g-details-text">{task.description}</p>
      {ingredients.length > 0 ? (
        <>
          <h3 className="g-details-head">You need</h3>
          <ul className="g-details-list">
            {ingredients.map((line, i) => (
              <li key={`${line}-${i}`}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
      {task.checkpoints.length > 0 ? (
        <>
          <h3 className="g-details-head">Check</h3>
          <ul className="g-details-list">
            {task.checkpoints.map((c, i) => (
              <li key={`${c}-${i}`}>{c}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="g-details-text">
        <strong>Done when:</strong> {task.completionCue}
      </p>
      <p className="g-muted">
        {task.range ? `${task.range.low}–${task.range.high}` : task.minutes} min ·{" "}
        {task.timingBasis === "source" ? "timed by the recipe" : "estimated time"} · {task.attention}
      </p>
      {task.tip ? (
        <p className="g-details-text">
          <strong>Tip:</strong> {task.tip}
        </p>
      ) : null}
      {task.why ? (
        <p className="g-details-text">
          <strong>Why:</strong> {task.why}
        </p>
      ) : null}
    </section>
  );
}

/** The cook along's state: task, guide clock, timers, voice; saved per artifact. */
function GlassesCookAlong({
  artifact,
  escapeRef,
}: {
  artifact: CookAlongArtifact;
  escapeRef: RefObject<() => boolean>;
}) {
  const { tasks: order, totalMinutes } = useMemo(() => hudOrder(artifact.timelineDefinition), [artifact]);
  const [current, setCurrent] = useState(0);
  const [guide, setGuide] = useState<GuideClock>(GUIDE_IDLE);
  const [timers, setTimers] = useState<TaskTimer[]>([]);
  const [now, setNow] = useState(0);
  const [details, setDetails] = useState(false);
  const [voice, setVoice] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const timersRef = useRef<TaskTimer[]>([]);
  const guideRef = useRef<GuideClock>(GUIDE_IDLE);
  const voiceRef = useRef(true);
  const lastDue = useRef<number | null>(null);
  const restored = useRef(false);
  const pushedDetails = useRef(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const timerButton = useRef<HTMLButtonElement>(null);

  const say = useCallback((text: string, aloud: boolean) => {
    setAnnouncement(text);
    if (aloud && voiceRef.current) speak(text);
  }, []);

  const act = useCallback(
    (action: TimerAction) => {
      const before = timersRef.current;
      const after = timersReducer(before, action);
      if (after === before) return;
      timersRef.current = after;
      setTimers(after);
      const finished = newlyDone(before, after);
      if (finished.length === 0) return;
      const names = finished.map((id) => {
        const found = order.find((o) => o.task.id === id);
        return found ? taskHeading(found.task) : "A timer";
      });
      say(names.map((name) => `${name} is done`).join(". "), true);
      setFlashing((prev) => new Set([...prev, ...finished]));
      setTimeout(() => {
        setFlashing((prev) => new Set([...prev].filter((id) => !finished.includes(id))));
      }, 6000);
    },
    [order, say],
  );

  const goTo = useCallback(
    (index: number, byGuide: boolean) => {
      if (index < 0 || index > order.length - 1) return;
      const bounded = index;
      setCurrent(bounded);
      const heading = taskHeading(order[bounded].task);
      say(byGuide ? `Now: ${heading}` : `Step ${bounded + 1} of ${order.length}: ${heading}`, byGuide);
    },
    [order, say],
  );

  // Restore what this cook along had (timers keep running across reloads).
  useEffect(() => {
    const id = setTimeout(() => {
      const ids = new Set(order.map((o) => o.task.id));
      let saved: GlassesSaved | null = null;
      try {
        saved = parseSaved(window.localStorage.getItem(glassesStorageKey(artifact.id)), ids);
      } catch {
        saved = null;
      }
      const on = readVoice();
      voiceRef.current = on;
      setVoice(on);
      const t = Date.now();
      setNow(t);
      if (saved) {
        const index = saved.currentTaskId ? order.findIndex((o) => o.task.id === saved.currentTaskId) : -1;
        if (index >= 0) setCurrent(index);
        guideRef.current = saved.guide;
        setGuide(saved.guide);
        // A running guide moves to the task due now on the next tick.
        lastDue.current = saved.guide.startedAt !== null ? null : lastDue.current;
        timersRef.current = saved.timers;
        setTimers(saved.timers);
      }
      restored.current = true;
    }, 0);
    return () => clearTimeout(id);
  }, [artifact.id, order]);

  // Save after every change, once restored.
  useEffect(() => {
    if (!restored.current) return;
    const saved: GlassesSaved = { v: 1, currentTaskId: order[current]?.task.id ?? null, guide, timers };
    try {
      window.localStorage.setItem(glassesStorageKey(artifact.id), JSON.stringify(saved));
    } catch {
      // Blocked storage: this visit still works, it just won't survive a reload.
    }
  }, [artifact.id, order, current, guide, timers]);

  // One clock for the countdowns and the guide.
  const tick = useCallback(() => {
    const t = Date.now();
    setNow(t);
    act({ type: "tick", now: t });
    const g = guideRef.current;
    if (g.startedAt === null) return;
    const due = dueIndex(order, Math.floor(guideElapsedMs(g, t) / 60_000));
    if (lastDue.current !== due) {
      lastDue.current = due;
      goTo(due, true);
    }
  }, [act, goTo, order]);
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });
  useEffect(() => {
    const id = setInterval(() => tickRef.current(), 500);
    return () => clearInterval(id);
  }, []);

  const closeDetails = useCallback(() => {
    setDetails(false);
    if (pushedDetails.current) {
      pushedDetails.current = false;
      try {
        window.history.back();
      } catch {
        // No history to go back to: the overlay is closed already.
      }
    }
    setTimeout(() => detailsButton.current?.focus(), 0);
  }, []);

  useEffect(() => {
    escapeRef.current = () => {
      if (!details) return false;
      closeDetails();
      return true;
    };
  });

  // The glasses' back gesture (browser history) closes Details first.
  useEffect(() => {
    function onPop() {
      if (!pushedDetails.current) return;
      pushedDetails.current = false;
      setDetails(false);
      setTimeout(() => detailsButton.current?.focus(), 0);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openDetails() {
    setDetails(true);
    try {
      window.history.pushState({ textsousGlassesDetails: true }, "");
      pushedDetails.current = true;
    } catch {
      pushedDetails.current = false;
    }
  }

  function toggleGuide() {
    const t = Date.now();
    setNow(t);
    if (guide.startedAt !== null) {
      const paused = pauseGuide(guide, t);
      guideRef.current = paused;
      setGuide(paused);
      return;
    }
    // Starting runs the schedule from the task on screen.
    const due = dueIndex(order, Math.floor(guideElapsedMs(guide, t) / 60_000));
    const started = startGuide(guide, t, due === current ? undefined : order[current].start);
    lastDue.current = dueIndex(order, Math.floor(guideElapsedMs(started, t) / 60_000));
    guideRef.current = started;
    setGuide(started);
    say(`Now: ${taskHeading(order[current].task)}`, true);
  }

  function onTimer(kind: "start" | "pause" | "resume" | "minus" | "plus" | "stop") {
    const t = Date.now();
    setNow(t);
    const taskId = order[current].task.id;
    if (kind === "start") act({ type: "start", taskId, durationMs: taskTimerMs(order[current].task), now: t });
    else if (kind === "pause") act({ type: "pause", taskId, now: t });
    else if (kind === "resume") act({ type: "resume", taskId, now: t });
    else if (kind === "minus") act({ type: "adjust", taskId, deltaMs: -60_000, now: t });
    else if (kind === "plus") act({ type: "adjust", taskId, deltaMs: 60_000, now: t });
    else {
      act({ type: "stop", taskId });
      // Stop takes its row away: keep the D-pad on this task's Timer button.
      setTimeout(() => timerButton.current?.focus(), 0);
    }
  }

  function toggleVoice() {
    const on = !voice;
    voiceRef.current = on;
    setVoice(on);
    storeVoice(on);
    if (!on) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Nothing to stop.
      }
    }
  }

  function jump(taskId: string) {
    const index = order.findIndex((o) => o.task.id === taskId);
    if (index >= 0) goTo(index, false);
  }

  return (
    <>
      <GlassesHud
        artifact={artifact}
        order={order}
        totalMinutes={totalMinutes}
        current={current}
        now={now}
        guide={guide}
        timers={timers}
        voice={voice}
        announcement={announcement}
        flashing={flashing}
        onPrev={() => goTo(current - 1, false)}
        onNext={() => goTo(current + 1, false)}
        onToggleGuide={toggleGuide}
        onDetails={openDetails}
        onTimer={onTimer}
        onJump={jump}
        onToggleVoice={toggleVoice}
        detailsButtonRef={detailsButton}
        timerButtonRef={timerButton}
      />
      {details ? (
        <GlassesDetails
          artifact={artifact}
          item={order[current]}
          number={current + 1}
          count={order.length}
          onBack={closeDetails}
        />
      ) : null}
    </>
  );
}

/**
 * On a phone or computer: the link that puts this page on Meta Ray-Ban
 * Display. Hidden on the 600 x 600 glasses screen by CSS.
 */
export function InstallPanel({ pageUrl: given }: { pageUrl?: string }) {
  const [pageUrl, setPageUrl] = useState(given ?? "");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (given) return;
    const id = setTimeout(() => setPageUrl(window.location.href), 0);
    return () => clearTimeout(id);
  }, [given]);
  if (!pageUrl) return null;
  const link = glassesInstallLink(pageUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="g-install" aria-label="Put this on your glasses">
      <h2 className="g-install-title">Put this on your glasses</h2>
      <p className="g-muted">
        Turn on Developer Mode in the Meta AI app, then open this link on the phone paired with your
        Meta Ray-Ban Display. In Meta&apos;s simulator, scan its View on Glasses QR code instead.
      </p>
      <code className="g-install-link">{link}</code>
      <div className="g-row">
        <button type="button" className="g-btn" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <a className="g-btn" href={link}>
          Open in the Meta AI app
        </a>
      </div>
    </aside>
  );
}
