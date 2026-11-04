/** Local timeline guidance and recipe-specific independent timers. All clocks and
 * persistence are caller supplied; elapsed time never asserts food completion.
 * Guidance pause freezes the marker, not heat, cooking or independent timers. */
import { z } from "zod/v3";
import { MAX_TASK_MINUTES, type CookingPlan } from "./plan";

export const TIMELINE_SESSION_STORAGE_KEY = "sous:cooking-timeline:v2";
export const MAX_TIMELINE_NOTE_LENGTH = 10_000;
export const MAX_STORED_TIMELINE_LENGTH = 600_000;
export const MAX_COUNTDOWN_SECONDS = 86_400;
export const MAX_TIMELINE_LANES = 41;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const timestamp = z.number().int().min(0).max(MAX_TIMESTAMP);
const identityText = z.string().min(1).max(300).refine(value => value.trim().length > 0);
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
// Saved recipes can combine a source ID with a full conversion fingerprint.
// Match the stored recipe contract without expanding task/lane ID limits.
const recipeStorageId = z.string().min(1).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const minutes = z.number().int().min(1).max(MAX_TASK_MINUTES);
const countdownSeconds = z.number().int().min(1).max(MAX_COUNTDOWN_SECONDS);
const laneId = id;
const laneIdsSchema = z.array(laneId).min(1).max(MAX_TIMELINE_LANES)
  .refine(values => new Set(values).size === values.length);
// Version 2 sessions predate per-recipe lanes and task lists; the open site
// never wrote one, so they carry no lanes or tasks here.
const LEGACY_LANE_IDS: readonly string[] = [];
const timerMode = z.enum(["count-up", "countdown"]);
const identitySchema = z.object({ sourceIdentity: identityText, planIdentity: identityText }).strict();
const guidanceSchema = z.object({
  startedAtMs: timestamp.nullable(), runningSinceMs: timestamp.nullable(), accumulatedMs: timestamp,
}).strict();
const timerSchema = z.object({
  mode: timerMode, countdownSeconds,
  runningSinceMs: timestamp.nullable(), accumulatedMs: timestamp,
}).strict();
// Missing `added` in earlier v4 saves means false. Keep it optional so parsing
// alone does not rewrite a saved session or its storage-conflict baseline.
const taskTimerSchema = timerSchema.extend({ usesPreset: z.boolean(), added: z.boolean().optional() }).strict();
const sessionFields = {
  sessionId: id,
  sourceIdentity: identityText, planIdentity: identityText,
  createdAtMs: timestamp, updatedAtMs: timestamp,
  guidance: guidanceSchema,
  timers: z.record(laneId, timerSchema).refine(value => Object.keys(value).length <= MAX_TIMELINE_LANES),
  notes: z.string().max(MAX_TIMELINE_NOTE_LENGTH), timingOverrides: z.record(id, minutes),
};
const timelineSessionSchema = z.discriminatedUnion("version", [
  z.object({ version: z.literal(2), ...sessionFields }).strict(),
  z.object({ version: z.literal(3), laneIds: laneIdsSchema, ...sessionFields }).strict(),
  z.object({ version: z.literal(4), laneIds: laneIdsSchema, ...sessionFields,
    taskTimers: z.record(id, taskTimerSchema).refine(value => Object.keys(value).length <= 100),
  }).strict(),
]);
const taskDefinitionsSchema = z.array(z.object({
  id, editableMinutes: z.boolean().optional(), maxMinutes: minutes.optional(), minutes: z.number().positive().finite().optional(),
  timerEnabledByDefault: z.boolean().optional(),
}).passthrough()).min(1).max(100);

export type TimelineIdentity = z.infer<typeof identitySchema>;
export type TimelineSession = z.infer<typeof timelineSessionSchema>;
export type LaneTimerState = z.infer<typeof timerSchema>;
export type TaskTimerState = z.infer<typeof taskTimerSchema>;
export type TaskTimelineSession = Extract<TimelineSession, { version: 4 }>;
export interface TimelineTaskDefinition { id: string; editableMinutes?: boolean; maxMinutes?: number; minutes?: number; timerEnabledByDefault?: boolean }
const LEGACY_TASKS: readonly TimelineTaskDefinition[] = [];
export interface TaskTimerPreset { countdownSeconds: number }
export type TaskTimerPresets = Readonly<Record<string, TaskTimerPreset>>;

/** The caller supplies explicit instruction-timing metadata. Phase, attention
 * and estimated task length cannot establish whether a timer belongs on a card.
 * A timer the cook added, configured or used stays visible, including after Reset. */
export function shouldShowTaskTimer(task: Pick<TimelineTaskDefinition, "timerEnabledByDefault">, state?: TaskTimerState): boolean {
  return task.timerEnabledByDefault === true || Boolean(state && (state.added === true || state.usesPreset === false
    || state.runningSinceMs !== null || state.accumulatedMs > 0));
}
export interface LaneTimerPreset {
  taskId: string | null;
  taskLabel: string | null;
  countdownSeconds: number;
  timingBasis: "source" | "estimate" | null;
}

/** A suggested manual timer, not an automatic task clock. Shared work may
 * suggest the same interval in several lanes; it remains one scheduled task.
 * Component timers prefer actual unattended cooking over preparation/loading.
 * A lane without required work gets a clearly unbound five-minute countdown. */
export function buildLaneTimerPresets(plan: Pick<CookingPlan, "lanes" | "tasks">): Record<string, LaneTimerPreset> {
  if (!laneIdsSchema.safeParse(plan.lanes.map(lane => lane.id)).success) throw new Error("Invalid timer preset lanes");
  const chronological = plan.tasks.filter(task => !task.optional).slice().sort((left, right) => left.startMinute - right.startMinute);
  return Object.fromEntries(plan.lanes.map(lane => {
    const candidates = chronological.filter(task => task.laneIds.includes(lane.id));
    const task = lane.kind === "kitchen" ? candidates.find(task => task.attention === "unattended") ?? candidates[0]
      : candidates.find(task => task.phase === "cook" && task.attention === "unattended")
        ?? candidates.find(task => task.phase === "cook") ?? candidates[0];
    const seconds = task ? task.minutes * 60 : 300;
    if (!countdownSeconds.safeParse(seconds).success) throw new Error("Invalid timer preset duration");
    return [lane.id, { taskId: task?.id ?? null, taskLabel: task?.label ?? null,
      countdownSeconds: seconds, timingBasis: task?.timingBasis ?? null }];
  }));
}

/** One clock per task, including shared tasks rendered across several lanes.
 * Use the rebuilt plan so editable estimates, not just source defaults, apply. */
export function buildTaskTimerPresets(plan: Pick<CookingPlan, "tasks">): Record<string, TaskTimerPreset> {
  if (!taskDefinitionsSchema.safeParse(plan.tasks).success
    || new Set(plan.tasks.map(task => task.id)).size !== plan.tasks.length) throw new Error("Invalid timer preset tasks");
  return Object.fromEntries(plan.tasks.map(task => {
    const seconds = task.minutes * 60;
    if (!countdownSeconds.safeParse(seconds).success) throw new Error("Invalid timer preset duration");
    return [task.id, { countdownSeconds: seconds }];
  }));
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("guidance-start"), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("guidance-pause"), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("guidance-resume"), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("timer-configure"), laneId, mode: timerMode, countdownSeconds: countdownSeconds.optional(), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("timer-start"), laneId, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("timer-stop"), laneId, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("timer-reset"), laneId, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("task-timer-configure"), taskId: id, mode: timerMode, countdownSeconds: countdownSeconds.optional(), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("task-timer-start"), taskId: id, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("task-timer-stop"), taskId: id, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("task-timer-reset"), taskId: id, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("task-timer-add"), taskId: id, nowMs: timestamp }).strict(),
  z.object({ type: z.literal("note"), text: z.string().max(MAX_TIMELINE_NOTE_LENGTH), nowMs: timestamp }).strict(),
  z.object({ type: z.literal("override"), taskId: id, minutes, nowMs: timestamp }).strict(),
]);
export type TimelineSessionAction = z.infer<typeof actionSchema>;
export type TimelineSessionResult =
  | { ok: true; session: TimelineSession }
  | { ok: false; session: TimelineSession; error: string };
export type StoredTimelineSessionResult =
  | { status: "restored"; session: TimelineSession }
  | { status: "empty" | "invalid" | "stale"; session: null };

/** A stable recipe ID separates v3 saves without concealing stale revisions.
 * No storage is read or migrated here. The no-argument legacy key is retained
 * only for callers that still use the old four-lane v2 session API. */
export function timelineSessionStorageKey(recipeId?: string): string {
  if (recipeId === undefined) return TIMELINE_SESSION_STORAGE_KEY;
  if (!recipeStorageId.safeParse(recipeId).success) throw new Error("A stable recipe ID is required for timeline storage");
  return `sous:cooking-timeline:v3:${encodeURIComponent(recipeId)}`;
}

function consistent(session: TimelineSession, definitions: readonly TimelineTaskDefinition[], expectedLaneIds: readonly string[] = LEGACY_LANE_IDS): boolean {
  if (!taskDefinitionsSchema.safeParse(definitions).success || !laneIdsSchema.safeParse(expectedLaneIds).success
    || session.updatedAtMs < session.createdAtMs) return false;
  const savedLanes = session.version !== 2 ? session.laneIds : LEGACY_LANE_IDS;
  if (savedLanes.length !== expectedLaneIds.length || savedLanes.some((lane, index) => lane !== expectedLaneIds[index])
    || Object.keys(session.timers).length !== expectedLaneIds.length
    || expectedLaneIds.some(lane => !Object.hasOwn(session.timers, lane))) return false;
  const all = new Map(definitions.map(task => [task.id, task]));
  if (all.size !== definitions.length || definitions.some(task => !id.safeParse(task.id).success
    || (task.maxMinutes !== undefined && !minutes.safeParse(task.maxMinutes).success))) return false;
  if (Object.entries(session.timingOverrides).some(([key, value]) => !all.get(key)?.editableMinutes
    || value > (all.get(key)?.maxMinutes ?? MAX_TASK_MINUTES))) return false;
  if (session.version === 4 && (Object.keys(session.taskTimers).length !== definitions.length
    || definitions.some(task => !Object.hasOwn(session.taskTimers, task.id))
    || Object.values(session.taskTimers).some(timer => timer.usesPreset
      && (timer.mode !== "countdown" || timer.runningSinceMs !== null || timer.accumulatedMs !== 0)))) return false;
  const guidance = session.guidance;
  if (guidance.startedAtMs === null) {
    if (guidance.runningSinceMs !== null || guidance.accumulatedMs !== 0) return false;
  } else {
    if (guidance.startedAtMs < session.createdAtMs || guidance.startedAtMs > session.updatedAtMs) return false;
    const end = guidance.runningSinceMs ?? session.updatedAtMs;
    if (end < guidance.startedAtMs || end > session.updatedAtMs || guidance.accumulatedMs > end - guidance.startedAtMs) return false;
  }
  for (const timer of [...Object.values(session.timers), ...(session.version === 4 ? Object.values(session.taskTimers) : [])]) {
    const end = timer.runningSinceMs ?? session.updatedAtMs;
    if (end < session.createdAtMs || end > session.updatedAtMs || timer.accumulatedMs > end - session.createdAtMs) return false;
  }
  return true;
}

function newTaskTimers(definitions: readonly TimelineTaskDefinition[], overrides: Readonly<Record<string, number>>,
  presets?: TaskTimerPresets): Record<string, TaskTimerState> {
  if (!taskDefinitionsSchema.safeParse(definitions).success
    || new Set(definitions.map(task => task.id)).size !== definitions.length) throw new Error("Invalid task timer definitions");
  if (presets !== undefined && (presets === null || typeof presets !== "object" || Array.isArray(presets)
    || Object.keys(presets).length !== definitions.length
    || definitions.some(task => !Object.hasOwn(presets, task.id)))) throw new Error("Task timer presets must match every recipe task");
  return Object.fromEntries(definitions.map(task => {
    const preset = presets?.[task.id];
    if (presets !== undefined && (preset === null || typeof preset !== "object"
      || !countdownSeconds.safeParse(preset.countdownSeconds).success)) throw new Error("Invalid task timer preset duration");
    const seconds = Object.hasOwn(overrides, task.id) ? overrides[task.id] * 60
      : presets === undefined ? (task.minutes ?? NaN) * 60 : preset?.countdownSeconds;
    const parsedSeconds = countdownSeconds.safeParse(seconds);
    if (!parsedSeconds.success) throw new Error("Invalid task timer preset duration");
    return [task.id, { mode: "countdown", countdownSeconds: parsedSeconds.data,
      runningSinceMs: null, accumulatedMs: 0, usesPreset: true, added: false }];
  }));
}

/** Fresh task clocks never inherit the elapsed time or settings of lane clocks. */
export function createTaskTimelineSession(identity: TimelineIdentity, nowMs: number, sessionId: string,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS, laneIds: readonly string[] = LEGACY_LANE_IDS,
  presets?: TaskTimerPresets): TaskTimelineSession {
  return { ...createTimelineSession(identity, nowMs, sessionId, laneIds), version: 4, laneIds: [...laneIds],
    taskTimers: newTaskTimers(definitions, {}, presets) };
}

/** Compose with an accepted estimate edit before persisting that action. This
 * does not advance clocks/timestamps, and never rewrites manually set or used
 * clocks, even after an explicit Reset. */
export function syncTaskTimerPresets(session: TimelineSession, presets: TaskTimerPresets,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS, laneIds: readonly string[] = LEGACY_LANE_IDS): TimelineSession {
  if (!timelineSessionSchema.safeParse(session).success || !consistent(session, definitions, laneIds)) throw new Error("Invalid task timer session");
  if (session.version !== 4) return session;
  if (session.guidance.startedAtMs !== null) throw new Error("Change timer presets before starting timeline guidance");
  const fresh = newTaskTimers(definitions, session.timingOverrides, presets);
  return { ...session, taskTimers: Object.fromEntries(Object.entries(session.taskTimers)
    .map(([taskId, timer]) => [taskId, timer.usesPreset ? { ...timer, countdownSeconds: fresh[taskId].countdownSeconds } : timer])) };
}

/** Call only after the UI explicitly confirms replacing an existing session. */
export function createTimelineSession(identity: TimelineIdentity, nowMs: number, sessionId: string, laneIds?: readonly string[],
  presets?: Readonly<Record<string, Pick<LaneTimerPreset, "countdownSeconds">>>,
): TimelineSession {
  const parsed = identitySchema.safeParse(identity);
  const lanes = laneIdsSchema.safeParse(laneIds === undefined ? LEGACY_LANE_IDS : laneIds);
  if (!parsed.success || !timestamp.safeParse(nowMs).success || !id.safeParse(sessionId).success || !lanes.success) throw new Error("Invalid timeline-session setup");
  if (presets !== undefined && (presets === null || typeof presets !== "object" || Array.isArray(presets)
    || Object.entries(presets).some(([lane, preset]) => !lanes.data.includes(lane)
      || preset === null || typeof preset !== "object" || !countdownSeconds.safeParse(preset.countdownSeconds).success))) {
    throw new Error("Invalid timeline-session timer presets");
  }
  const timer = (lane: string): LaneTimerState => ({ mode: "countdown",
    countdownSeconds: presets && Object.hasOwn(presets, lane) ? presets[lane].countdownSeconds : 300,
    runningSinceMs: null, accumulatedMs: 0 });
  return {
    ...(laneIds === undefined ? { version: 2 as const } : { version: 3 as const, laneIds: lanes.data }),
    sessionId, ...parsed.data, createdAtMs: nowMs, updatedAtMs: nowMs,
    guidance: { startedAtMs: null, runningSinceMs: null, accumulatedMs: 0 },
    timers: Object.fromEntries(lanes.data.map(lane => [lane, timer(lane)])),
    notes: "", timingOverrides: {},
  };
}

// Absolute timestamps survive throttled callbacks, sleep and reload. Reading
// more or less often never advances the clock; only explicit pause/stop excludes
// time away. Device wall-clock corrections remain visible in these timestamps.
function elapsed(clock: { runningSinceMs: number | null; accumulatedMs: number }, nowMs: number): number {
  return clock.accumulatedMs + (clock.runningSinceMs === null ? 0 : Math.max(0, nowMs - clock.runningSinceMs));
}

/** No tick or completion action exists. Repeated start/stop events are
 * idempotent; stopping retains elapsed time and reset explicitly clears it. */
export function reduceTimelineSession(
  session: TimelineSession,
  input: TimelineSessionAction,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS,
  laneIds: readonly string[] = LEGACY_LANE_IDS,
): TimelineSessionResult {
  const fail = (error: string): TimelineSessionResult => ({ ok: false, session, error });
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return fail("That timeline action is invalid or exceeds its limit.");
  if (!timelineSessionSchema.safeParse(session).success || !consistent(session, definitions, laneIds)) return fail("This saved timeline needs to be reset before recording changes.");
  const action = parsed.data;
  if (action.nowMs < session.updatedAtMs) return fail("Your device clock moved backwards. Check its time before changing the timeline.");
  const change = (patch: Partial<Pick<TimelineSession, "guidance" | "timers" | "notes" | "timingOverrides">>): TimelineSessionResult => ({ ok: true, session: { ...session, ...patch, updatedAtMs: action.nowMs } });
  if (action.type === "note") return change({ notes: action.text });
  if (action.type === "override") {
    const task = definitions.find(task => task.id === action.taskId);
    if (!task?.editableMinutes) return fail("Only preparation and handling estimates can be edited; recipe cooking intervals stay fixed.");
    if (action.minutes > (task.maxMinutes ?? MAX_TASK_MINUTES)) return fail(`This estimate must fit within 1 to ${task.maxMinutes ?? MAX_TASK_MINUTES} minutes.`);
    if (session.guidance.startedAtMs !== null) return fail("Change estimates before starting the timeline. Start a new session to change the plan afterwards.");
    return change({ timingOverrides: { ...session.timingOverrides, [action.taskId]: action.minutes } });
  }
  if (action.type === "guidance-start") {
    if (session.guidance.startedAtMs !== null) return session.guidance.runningSinceMs !== null ? { ok: true, session } : fail("Resume the paused timeline instead of starting it again.");
    return change({ guidance: { startedAtMs: action.nowMs, runningSinceMs: action.nowMs, accumulatedMs: 0 } });
  }
  if (action.type === "guidance-pause") {
    if (session.guidance.startedAtMs === null) return fail("Start the timeline before pausing its guidance.");
    if (session.guidance.runningSinceMs === null) return { ok: true, session };
    return change({ guidance: { ...session.guidance, runningSinceMs: null, accumulatedMs: elapsed(session.guidance, action.nowMs) } });
  }
  if (action.type === "guidance-resume") {
    if (session.guidance.startedAtMs === null) return fail("Start the timeline before resuming its guidance.");
    if (session.guidance.runningSinceMs !== null) return { ok: true, session };
    return change({ guidance: { ...session.guidance, runningSinceMs: action.nowMs } });
  }
  if (action.type === "task-timer-start" || action.type === "task-timer-stop"
    || action.type === "task-timer-reset" || action.type === "task-timer-configure" || action.type === "task-timer-add") {
    if (session.version !== 4 || !Object.hasOwn(session.taskTimers, action.taskId)
      || !definitions.some(task => task.id === action.taskId)) return fail("That step timer is not part of this recipe.");
    const timer = session.taskTimers[action.taskId];
    const changeTaskTimer = (patch: Partial<TaskTimerState>): TimelineSessionResult => ({ ok: true,
      session: { ...session, updatedAtMs: action.nowMs,
        taskTimers: { ...session.taskTimers, [action.taskId]: { ...timer, ...patch } } } });
    if (action.type === "task-timer-add") return timer.added === true ? { ok: true, session } : changeTaskTimer({ added: true });
    if (action.type === "task-timer-configure") {
      const seconds = action.countdownSeconds ?? timer.countdownSeconds;
      if (action.mode === timer.mode && seconds === timer.countdownSeconds) return { ok: true, session };
      if (timer.runningSinceMs !== null) return fail("Stop this step timer before changing its mode or countdown.");
      if (timer.accumulatedMs > 0) return fail("Reset this stopped timer before changing its mode or countdown; its recorded time is retained until then.");
      return changeTaskTimer({ mode: action.mode, countdownSeconds: seconds, usesPreset: false });
    }
    if (action.type === "task-timer-start") {
      if (timer.runningSinceMs !== null) return { ok: true, session };
      return changeTaskTimer({ runningSinceMs: action.nowMs, usesPreset: false });
    }
    if (action.type === "task-timer-stop") {
      if (timer.runningSinceMs === null) return { ok: true, session };
      return changeTaskTimer({ runningSinceMs: null, accumulatedMs: elapsed(timer, action.nowMs) });
    }
    return changeTaskTimer({ runningSinceMs: null, accumulatedMs: 0 });
  }
  if (!laneIds.includes(action.laneId) || !Object.hasOwn(session.timers, action.laneId)) return fail("That timer lane is not part of this recipe.");
  const timer = session.timers[action.laneId];
  const changeTimer = (patch: Partial<LaneTimerState>) => change({ timers: { ...session.timers, [action.laneId]: { ...timer, ...patch } } });
  if (action.type === "timer-configure") {
    const seconds = action.countdownSeconds ?? timer.countdownSeconds;
    if (action.mode === timer.mode && seconds === timer.countdownSeconds) return { ok: true, session };
    if (timer.runningSinceMs !== null) return fail("Stop this lane timer before changing its mode or countdown.");
    if (timer.accumulatedMs > 0) return fail("Reset this stopped timer before changing its mode or countdown; its recorded time is retained until then.");
    return changeTimer({ mode: action.mode, countdownSeconds: seconds, accumulatedMs: 0 });
  }
  if (action.type === "timer-start") {
    if (timer.runningSinceMs !== null) return { ok: true, session };
    return changeTimer({ runningSinceMs: action.nowMs });
  }
  if (action.type === "timer-stop") {
    if (timer.runningSinceMs === null) return { ok: true, session };
    return changeTimer({ runningSinceMs: null, accumulatedMs: elapsed(timer, action.nowMs) });
  }
  // A reset stops only this timer and keeps its selected mode/countdown.
  return changeTimer({ runningSinceMs: null, accumulatedMs: 0 });
}

export function parseStoredTimelineSession(
  raw: string | null,
  identity: TimelineIdentity,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS,
  laneIds: readonly string[] = LEGACY_LANE_IDS,
): StoredTimelineSessionResult {
  if (raw === null) return { status: "empty", session: null };
  if (raw.length > MAX_STORED_TIMELINE_LENGTH || !identitySchema.safeParse(identity).success) return { status: "invalid", session: null };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return { status: "invalid", session: null }; }
  const parsed = timelineSessionSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", session: null };
  if (parsed.data.sourceIdentity !== identity.sourceIdentity || parsed.data.planIdentity !== identity.planIdentity) return { status: "stale", session: null };
  if (!consistent(parsed.data, definitions, laneIds)) return { status: "invalid", session: null };
  // Old count-up defaults are indistinguishable from an intentionally selected
  // or reset count-up timer. Preserve every saved configuration and clock;
  // the new countdown presets apply only when creating a fresh session.
  return { status: "restored", session: parsed.data };
}

/** In-memory migration only: callers keep the original raw storage baseline
 * until their next explicit action. Older lane clocks remain independently
 * accessible; no old observation is attributed to a step. */
export function parseStoredTaskTimelineSession(raw: string | null, identity: TimelineIdentity,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS, laneIds: readonly string[] = LEGACY_LANE_IDS,
  presets?: TaskTimerPresets): StoredTimelineSessionResult {
  const restored = parseStoredTimelineSession(raw, identity, definitions, laneIds);
  if (restored.status !== "restored" || restored.session.version === 4) return restored;
  try {
    return { status: "restored", session: { ...restored.session, version: 4, laneIds: [...laneIds],
      taskTimers: newTaskTimers(definitions, restored.session.timingOverrides, presets) } };
  } catch { return { status: "invalid", session: null }; }
}

/** Only observed legacy clocks need recovery controls in the step-timer UI. */
export function legacyLaneTimerIds(session: TimelineSession): string[] {
  return Object.entries(session.timers).filter(([, timer]) => timer.runningSinceMs !== null || timer.accumulatedMs > 0)
    .map(([lane]) => lane);
}

export function hasRunningTimelineTimers(session: TimelineSession): boolean {
  return Object.values(session.timers).some(timer => timer.runningSinceMs !== null)
    || (session.version === 4 && Object.values(session.taskTimers).some(timer => timer.runningSinceMs !== null));
}

function readClock(session: TimelineSession, nowMs: number) {
  if (!timestamp.safeParse(nowMs).success) throw new Error("A valid current timestamp is required");
  return { nowMs: Math.max(nowMs, session.updatedAtMs), clockReversed: nowMs < session.updatedAtMs };
}

/** Pausing accumulates a projected delay: effective anchor = now - active
 * guidance time. This is guidance only, not a revised cooking/holding method. */
export function readTimeline(session: TimelineSession, nowMs: number, serveMinute: number) {
  if (!Number.isFinite(serveMinute) || serveMinute < 0 || serveMinute > 86_400) throw new Error("Invalid planned serving offset");
  const clock = readClock(session, nowMs);
  const elapsedMs = elapsed(session.guidance, clock.nowMs);
  const hasStarted = session.guidance.startedAtMs !== null;
  const effectiveAnchorMs = hasStarted ? clock.nowMs - elapsedMs : null;
  const estimate = effectiveAnchorMs === null ? null : effectiveAnchorMs + serveMinute * 60_000;
  return {
    hasStarted, isRunning: session.guidance.runningSinceMs !== null,
    startedAtMs: session.guidance.startedAtMs, elapsedMs, elapsedSeconds: Math.floor(elapsedMs / 1000),
    effectiveAnchorMs, estimatedServeAtMs: estimate !== null && estimate <= MAX_TIMESTAMP ? estimate : null,
    pausedMs: hasStarted ? clock.nowMs - session.guidance.startedAtMs! - elapsedMs : 0,
    clockReversed: clock.clockReversed,
  };
}

export function readLaneTimer(session: TimelineSession, lane: string, nowMs: number) {
  const lanes: readonly string[] = session.version !== 2 ? session.laneIds : LEGACY_LANE_IDS;
  if (!laneId.safeParse(lane).success || !lanes.includes(lane) || !Object.hasOwn(session.timers, lane)) throw new Error("Unknown timer lane");
  return readTimer(session, session.timers[lane], nowMs);
}

export function readTaskTimer(session: TimelineSession, taskId: string, nowMs: number) {
  if (session.version !== 4 || !id.safeParse(taskId).success || !Object.hasOwn(session.taskTimers, taskId)) throw new Error("Unknown step timer");
  return readTimer(session, session.taskTimers[taskId], nowMs);
}

function readTimer(session: TimelineSession, timer: LaneTimerState, nowMs: number) {
  const clock = readClock(session, nowMs);
  const elapsedMs = elapsed(timer, clock.nowMs);
  const remainingMs = timer.mode === "countdown" ? timer.countdownSeconds * 1000 - elapsedMs : null;
  const overdueMs = remainingMs === null ? 0 : Math.max(0, -remainingMs);
  return {
    mode: timer.mode, countdownSeconds: timer.countdownSeconds,
    isRunning: timer.runningSinceMs !== null, elapsedMs, elapsedSeconds: Math.floor(elapsedMs / 1000),
    remainingMs, remainingSeconds: remainingMs === null ? null : Math.ceil(Math.max(0, remainingMs) / 1000),
    overdueMs, overdueSeconds: Math.floor(overdueMs / 1000), isDue: remainingMs !== null && remainingMs <= 0,
    clockReversed: clock.clockReversed,
  };
}

/** Local observations only. No food completion, recipe rating or provider
 * effect is recorded, and exporting does not advance or stop any clock. */
export function exportTimelineSession(session: TimelineSession, nowMs: number,
  definitions: readonly TimelineTaskDefinition[] = LEGACY_TASKS,
  laneIds: readonly string[] = LEGACY_LANE_IDS,
): string {
  if (!timelineSessionSchema.safeParse(session).success || !consistent(session, definitions, laneIds)
    || !timestamp.safeParse(nowMs).success) throw new Error("Invalid timeline-session export");
  return JSON.stringify({
    kind: "local-cooking-timeline", exportVersion: session.version, exportedAtMs: nowMs, session,
    guidanceElapsedMs: readTimeline(session, nowMs, 0).elapsedMs,
    laneTimers: Object.fromEntries(laneIds.map(lane => [lane, readLaneTimer(session, lane, nowMs)])),
    ...(session.version === 4 ? { taskTimers: Object.fromEntries(definitions.map(task => [task.id, readTaskTimer(session, task.id, nowMs)])) } : {}),
    observationBasis: "guidance-and-independent-timers-only",
  }, null, 2);
}
