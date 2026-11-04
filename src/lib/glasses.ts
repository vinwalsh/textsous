/**
 * Pure logic for the heads-up Cook Along on Meta Ray-Ban Display (/glasses):
 * task order and the guide clock from the schedule, task timers, saved
 * state, the install link and link checks. Client-safe: no node imports.
 */
import { parseEmbedRequest, type EmbedRequest } from "./embed";
import type { CookAlongArtifact } from "./schema/artifact";
import type { TimelineDefinition, TimelineTask } from "./schema/timeline";
import { formatQuantityWithUnit } from "./scaling/units";
import { schedule } from "./scheduler/schedule";

/** The web app's name on the glasses (also its application-name meta tag). */
export const GLASSES_APP_NAME = "TextSous Cook Along";

export interface HudTask {
  task: TimelineTask;
  /** Minute the schedule starts this task. */
  start: number;
  end: number;
}

/**
 * Tasks in the order the schedule starts them; tasks that start together
 * keep their timeline order. If the schedule cannot be computed, the tasks
 * run back to back in timeline order.
 */
export function hudOrder(timeline: TimelineDefinition): { tasks: HudTask[]; totalMinutes: number } {
  try {
    const result = schedule(timeline);
    const byId = new Map(timeline.tasks.map((task, index) => [task.id, { task, index }] as const));
    const items = result.tasks.flatMap((s) => {
      const found = byId.get(s.id);
      return found ? [{ ...found, start: s.startMinutes, end: s.endMinutes }] : [];
    });
    items.sort((a, b) => a.start - b.start || a.index - b.index);
    return {
      tasks: items.map(({ task, start, end }) => ({ task, start, end })),
      totalMinutes: result.totalMinutes,
    };
  } catch {
    let at = 0;
    const tasks = timeline.tasks.map((task) => {
      const item = { task, start: at, end: at + task.minutes };
      at += task.minutes;
      return item;
    });
    return { tasks, totalMinutes: at };
  }
}

/**
 * The task due at a guide minute: of the tasks that have started, the first
 * one with the latest start (the first task before anything starts).
 */
export function dueIndex(tasks: ReadonlyArray<{ start: number }>, minute: number): number {
  let due = 0;
  tasks.forEach((t, i) => {
    if (t.start <= minute && t.start > tasks[due].start) due = i;
  });
  return due;
}

/** The guide clock: elapsed time of the cook along, paused or running. */
export interface GuideClock {
  elapsedMs: number;
  /** When it last started running (epoch ms), or null while paused. */
  startedAt: number | null;
}

export const GUIDE_IDLE: GuideClock = { elapsedMs: 0, startedAt: null };

export function guideElapsedMs(clock: GuideClock, now: number): number {
  return clock.elapsedMs + (clock.startedAt !== null ? Math.max(0, now - clock.startedAt) : 0);
}

/** Start (or resume) the guide; `fromMinute` moves the clock to that minute first. */
export function startGuide(clock: GuideClock, now: number, fromMinute?: number): GuideClock {
  if (clock.startedAt !== null) return clock;
  return { elapsedMs: fromMinute !== undefined ? fromMinute * 60_000 : clock.elapsedMs, startedAt: now };
}

export function pauseGuide(clock: GuideClock, now: number): GuideClock {
  if (clock.startedAt === null) return clock;
  return { elapsedMs: guideElapsedMs(clock, now), startedAt: null };
}

/** A countdown on one task. Several run at once (the pot and the oven). */
export interface TaskTimer {
  taskId: string;
  status: "running" | "paused" | "done";
  /** When a running timer ends (epoch ms); null otherwise. */
  endsAt: number | null;
  /** Time left while paused. */
  remainingMs: number;
}

export type TimerAction =
  | { type: "start"; taskId: string; durationMs: number; now: number }
  | { type: "pause"; taskId: string; now: number }
  | { type: "resume"; taskId: string; now: number }
  | { type: "adjust"; taskId: string; deltaMs: number; now: number }
  | { type: "stop"; taskId: string }
  | { type: "tick"; now: number }
  | { type: "restore"; timers: TaskTimer[] };

export function timerRemainingMs(timer: TaskTimer, now: number): number {
  if (timer.status === "done") return 0;
  if (timer.status === "running" && timer.endsAt !== null) return Math.max(0, timer.endsAt - now);
  return Math.max(0, timer.remainingMs);
}

const doneTimer = (taskId: string): TaskTimer => ({ taskId, status: "done", endsAt: null, remainingMs: 0 });

function updateTimer(state: TaskTimer[], taskId: string, update: (t: TaskTimer) => TaskTimer): TaskTimer[] {
  return state.map((t) => (t.taskId === taskId ? update(t) : t));
}

/**
 * Timer state: start, pause, resume, adjust (never below zero), stop, and
 * tick, which marks running timers whose time is up as done. Starting a
 * done timer starts it again; starting a running or paused one does nothing.
 */
export function timersReducer(state: TaskTimer[], action: TimerAction): TaskTimer[] {
  switch (action.type) {
    case "start": {
      const fresh: TaskTimer = {
        taskId: action.taskId,
        status: "running",
        endsAt: action.now + Math.max(0, action.durationMs),
        remainingMs: Math.max(0, action.durationMs),
      };
      const existing = state.find((t) => t.taskId === action.taskId);
      if (!existing) return [...state, fresh];
      return existing.status === "done" ? updateTimer(state, action.taskId, () => fresh) : state;
    }
    case "pause":
      return updateTimer(state, action.taskId, (t) => {
        if (t.status !== "running") return t;
        const left = timerRemainingMs(t, action.now);
        return left > 0 ? { ...t, status: "paused", endsAt: null, remainingMs: left } : doneTimer(t.taskId);
      });
    case "resume":
      return updateTimer(state, action.taskId, (t) =>
        t.status === "paused"
          ? { ...t, status: "running", endsAt: action.now + t.remainingMs, remainingMs: t.remainingMs }
          : t,
      );
    case "adjust":
      return updateTimer(state, action.taskId, (t) => {
        if (t.status === "done") {
          return action.deltaMs > 0
            ? { ...t, status: "running", endsAt: action.now + action.deltaMs, remainingMs: action.deltaMs }
            : t;
        }
        const left = Math.max(0, timerRemainingMs(t, action.now) + action.deltaMs);
        if (t.status === "paused") return { ...t, remainingMs: left };
        return left > 0 ? { ...t, endsAt: action.now + left, remainingMs: left } : doneTimer(t.taskId);
      });
    case "stop":
      return state.filter((t) => t.taskId !== action.taskId);
    case "tick":
      return state.some((t) => t.status === "running" && t.endsAt !== null && t.endsAt <= action.now)
        ? state.map((t) =>
            t.status === "running" && t.endsAt !== null && t.endsAt <= action.now ? doneTimer(t.taskId) : t,
          )
        : state;
    case "restore":
      return action.timers;
  }
}

/** Task ids whose timer was not done before and is done after (to announce). */
export function newlyDone(before: readonly TaskTimer[], after: readonly TaskTimer[]): string[] {
  const wasDone = new Set(before.filter((t) => t.status === "done").map((t) => t.taskId));
  return after.filter((t) => t.status === "done" && !wasDone.has(t.taskId)).map((t) => t.taskId);
}

/** A task's countdown: its minutes, or the high end of its range. */
export function taskTimerMs(task: Pick<TimelineTask, "minutes" | "range">): number {
  return Math.max(1, task.range?.high ?? task.minutes) * 60_000;
}

/** "Simmer porridge": the card's action and subject, no amounts or times. */
export function taskHeading(task: Pick<TimelineTask, "cardTitle">): string {
  return `${task.cardTitle.action} ${task.cardTitle.subject}`.trim();
}

/** The lanes a task belongs to, by name: component lanes first, the kitchen only when alone. */
export function laneName(task: Pick<TimelineTask, "laneIds">, lanes: TimelineDefinition["lanes"]): string {
  const named = task.laneIds.flatMap((id) => lanes.filter((lane) => lane.id === id));
  const components = named.filter((lane) => lane.kind === "component");
  return (components.length > 0 ? components : named).map((lane) => lane.label).join(" + ");
}

/** Countdown text: m:ss under an hour, h:mm:ss from an hour up. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Guide clock text (elapsed, rounded down): m:ss, or h:mm:ss from an hour up. */
export function formatElapsed(ms: number): string {
  return formatCountdown(Math.floor(Math.max(0, ms) / 1000) * 1000);
}

/** This task's ingredients as "2 cups whole milk", from scheduling.ingredientIds. */
export function taskIngredientLines(
  task: Pick<TimelineTask, "scheduling">,
  ingredients: CookAlongArtifact["recipe"]["ingredients"],
): string[] {
  const byId = new Map(ingredients.map((ing) => [ing.id, ing] as const));
  return task.scheduling.ingredientIds.flatMap((id) => {
    const ing = byId.get(id);
    if (!ing) return [];
    const amount = formatQuantityWithUnit(ing.cookQuantity ?? ing.quantity, ing.unit);
    return [`${amount} ${ing.name}`.trim()];
  });
}

/** What the glasses keep per cook along (localStorage), so a reload picks up. */
export interface GlassesSaved {
  v: 1;
  currentTaskId: string | null;
  guide: GuideClock;
  timers: TaskTimer[];
}

export function glassesStorageKey(artifactId: string): string {
  return `textsous:glasses:${artifactId}`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Saved state for this cook along, keeping only timers on tasks it has. Null if unreadable. */
export function parseSaved(raw: string | null, taskIds: ReadonlySet<string>): GlassesSaved | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const v = value as Partial<GlassesSaved> | null;
  if (!v || v.v !== 1 || !v.guide || !isNum(v.guide.elapsedMs)) return null;
  const startedAt = v.guide.startedAt;
  const guide: GuideClock = { elapsedMs: v.guide.elapsedMs, startedAt: isNum(startedAt) ? startedAt : null };
  const timers = (Array.isArray(v.timers) ? v.timers : []).filter(
    (t): t is TaskTimer =>
      !!t &&
      typeof t.taskId === "string" &&
      taskIds.has(t.taskId) &&
      (t.status === "running" || t.status === "paused" || t.status === "done") &&
      isNum(t.remainingMs) &&
      (t.endsAt === null || isNum(t.endsAt)) &&
      (t.status !== "running" || isNum(t.endsAt)),
  );
  const current = typeof v.currentTaskId === "string" && taskIds.has(v.currentTaskId) ? v.currentTaskId : null;
  return { v: 1, currentTaskId: current, guide, timers };
}

/**
 * The link that opens a web app on Meta Ray-Ban Display from the Meta AI
 * app (developer preview): appName plus the https address, both encoded.
 */
export function glassesInstallLink(appUrl: string, appName: string = GLASSES_APP_NAME): string {
  return `fb-viewapp://web_app_deep_link?appName=${encodeURIComponent(appName)}&appUrl=${encodeURIComponent(appUrl)}`;
}

const ARTIFACT_PATH = /^\/api\/artifact\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A `?src=` the glasses may load: this site's own signed artifact link
 * (`/api/artifact/<uuid>?sig=<64 hex>`), over https (http only on
 * localhost). Returns the absolute link, or null.
 */
export function glassesArtifactSrc(raw: string, pageOrigin: string): string | null {
  try {
    const page = new URL(pageOrigin);
    const url = new URL(raw, page);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.origin !== page.origin) return null;
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (!ARTIFACT_PATH.test(url.pathname)) return null;
    if (!/^[0-9a-f]{64}$/.test(url.searchParams.get("sig") ?? "")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A `?url=` recipe page the glasses may convert: an absolute http(s) address. */
export function glassesRecipeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** What /glasses was asked to show, from the page's query string (`?src=` wins over `?url=`). */
export function glassesRequestFromSearch(search: string): EmbedRequest {
  const params = new URLSearchParams(search);
  return parseEmbedRequest({ src: params.get("src") ?? undefined, url: params.get("url") ?? undefined });
}

export type Direction = "left" | "right" | "up" | "down";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * D-pad navigation: the nearest box in a direction from box `from`, by
 * centers, preferring boxes in line with it. Left and Right stay in the
 * row (boxes overlapping it vertically), so a row's end goes nowhere. Null
 * when none lies that way.
 */
export function spatialTarget(boxes: readonly Box[], from: number, dir: Direction): number | null {
  const a = boxes[from];
  if (!a) return null;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const sideways = dir === "left" || dir === "right";
  let best: number | null = null;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    if (sideways && (b.y >= a.y + a.h || b.y + b.h <= a.y)) return;
    const dx = b.x + b.w / 2 - ax;
    const dy = b.y + b.h / 2 - ay;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (along <= 1) return;
    const across = sideways ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function arrowDirection(key: string): Direction | null {
  return key === "ArrowLeft"
    ? "left"
    : key === "ArrowRight"
      ? "right"
      : key === "ArrowUp"
        ? "up"
        : key === "ArrowDown"
          ? "down"
          : null;
}
