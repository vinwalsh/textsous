import {
  cookingProcedureSchema,
  MAX_TIMELINE_SECONDS,
  type CookingProcedure,
  type SchedulingProcedure,
} from "./types";
import { validateExperimentalProcedure } from "./validation";

const DEFAULT_SEARCH_NODES = 1_000;
export const MAX_SEARCH_NODES = 10_000;

export interface ScheduledTask {
  id: string;
  startSec: number;
  endSec: number;
}

export interface AttentionInterval {
  startSec: number;
  endSec: number;
}

export interface CookingSchedule {
  /** Conservative max-duration estimate, not a guaranteed completion time. */
  elapsedSec: number;
  handsOnSec: number;
  /** Unoccupied cook attention, not a promise of recoverable delay/buffer. */
  freeAttentionIntervals: AttentionInterval[];
  tasks: ScheduledTask[];
  searchNodes: number;
}

export interface ScheduleOptions {
  availableSeconds?: number;
  maxSearchNodes?: number;
}

export type ScheduleResult =
  | ({ ok: true } & CookingSchedule)
  | {
    ok: false;
    reason: "unsupported" | "search_limit" | "no_schedule_found" | "too_late";
    message: string;
    /** A feasible conservative estimate, never a claim of minimum duration. */
    requiredSeconds?: number;
    searchNodes: number;
  };

export type ScheduleValidationResult =
  | { ok: true }
  | { ok: false; issues: string[] };

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const overlaps = (a: AttentionInterval, b: AttentionInterval) =>
  a.startSec < b.endSec && b.startSec < a.endSec;

/**
 * Independently checks the emitted timeline. It deliberately does not use the
 * solver's constraint graph or equipment-conflict construction. The procedure
 * must first pass validateProcedure against a trusted source/context.
 */
export function validateSchedule(
  procedure: SchedulingProcedure,
  schedule: Pick<CookingSchedule, "tasks">,
): ScheduleValidationResult {
  const issues: string[] = [];
  const times = new Map<string, ScheduledTask>();
  const definitions = new Map(procedure.tasks.map(task => [task.id, task]));
  for (const task of schedule.tasks) {
    if (times.has(task.id)) issues.push(`Duplicate scheduled task: ${task.id}`);
    times.set(task.id, task);
    const definition = definitions.get(task.id);
    if (!definition) issues.push(`Unknown scheduled task: ${task.id}`);
    if (!Number.isSafeInteger(task.startSec) || !Number.isSafeInteger(task.endSec)) {
      issues.push(`Task offsets must be finite integer seconds: ${task.id}`);
    }
    if (task.endSec > 0 || task.startSec < -MAX_TIMELINE_SECONDS) {
      issues.push(`Task is outside the supported serving horizon: ${task.id}`);
    }
    if (definition && task.endSec - task.startSec !== definition.duration.maxSeconds) {
      issues.push(`Task duration differs from the reviewed maximum: ${task.id}`);
    }
  }
  for (const task of procedure.tasks) {
    if (!times.has(task.id)) issues.push(`Missing scheduled task: ${task.id}`);
  }
  // Subsequent checks require complete, well-formed task intervals.
  if (issues.length) return { ok: false, issues };

  if (times.get(procedure.serveTaskId)?.endSec !== 0) {
    issues.push("The serving task must end at offset zero");
  }
  for (const task of procedure.tasks) {
    const current = times.get(task.id)!;
    for (const dependency of task.dependencies) {
      const prior = times.get(dependency.taskId);
      const gap = prior ? current.startSec - prior.endSec : NaN;
      if (!Number.isFinite(gap) || gap < dependency.minWaitSeconds || gap > dependency.maxWaitSeconds) {
        issues.push(`Dependency wait violated: ${dependency.taskId} -> ${task.id}`);
      }
    }
  }
  for (const containment of procedure.containments ?? []) {
    const process = times.get(containment.processTaskId), activity = times.get(containment.activityTaskId);
    if (!process || !activity || activity.startSec < process.startSec || activity.endSec > process.endSec) {
      issues.push(`Task containment violated: ${containment.activityTaskId} during ${containment.processTaskId}`);
    }
  }
  for (let i = 0; i < procedure.tasks.length; i++) {
    const a = procedure.tasks[i];
    for (const b of procedure.tasks.slice(i + 1)) {
      if (!overlaps(times.get(a.id)!, times.get(b.id)!)) continue;
      if (a.attention === "hands-on" && b.attention === "hands-on") {
        issues.push(`One cook cannot overlap tasks: ${a.id}, ${b.id}`);
      }
      for (const resource of a.resourceIds) {
        if (b.resourceIds.includes(resource)) {
          issues.push(`Exclusive resource ${resource} overlaps: ${a.id}, ${b.id}`);
        }
      }
    }
  }
  const holds = procedure.resourceHolds.map(hold => {
    const start = times.get(hold.startTaskId);
    const end = times.get(hold.endTaskId);
    if (!start || !end) return null;
    const interval = { startSec: start.startSec, endSec: end.endSec };
    for (const member of hold.taskIds) {
      const task = times.get(member);
      if (!task || task.startSec < interval.startSec || task.endSec > interval.endSec) {
        issues.push(`Held task falls outside ${hold.id}: ${member}`);
      }
    }
    for (const task of procedure.tasks) {
      if (!hold.taskIds.includes(task.id) && task.resourceIds.includes(hold.resourceId)
        && overlaps(interval, times.get(task.id)!)) {
        issues.push(`Resource hold ${hold.id} is interrupted by ${task.id}`);
      }
    }
    return { ...interval, id: hold.id, resourceId: hold.resourceId };
  });
  for (let i = 0; i < holds.length; i++) {
    const a = holds[i];
    if (!a) {
      issues.push("Resource hold references an unscheduled endpoint");
      continue;
    }
    for (const b of holds.slice(i + 1)) {
      if (b && a.resourceId === b.resourceId && overlaps(a, b)) {
        issues.push(`Resource holds overlap: ${a.id}, ${b.id}`);
      }
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true };
}

/** Difference constraint: start[to] <= start[from] + weight. */
interface Edge { from: number; to: number; weight: number }
interface Branch { parent?: Branch; edge?: Edge }
interface Occupancy {
  key: string;
  startTask: number;
  endTask: number;
  endDuration: number;
  taskId?: string;
  holdMembers?: Set<string>;
}

function latestStarts(base: Edge[], branch: Branch, taskCount: number): number[] | null {
  const edges = [...base];
  for (let node: Branch | undefined = branch; node; node = node.parent) {
    if (node.edge) edges.push(node.edge);
  }
  // The extra node is the fixed serving target, offset 0. Every task is
  // reachable backwards from it through the terminal serving task.
  const starts = Array<number>(taskCount + 1).fill(Infinity);
  starts[taskCount] = 0;
  for (let pass = 0; pass <= taskCount; pass++) {
    let changed = false;
    for (const edge of edges) {
      const candidate = starts[edge.from] + edge.weight;
      if (candidate < starts[edge.to]) {
        starts[edge.to] = candidate;
        changed = true;
      }
    }
    if (!changed) return starts.slice(0, taskCount);
  }
  // Inconsistent constraints in this branch, not a claim about other methods.
  return null;
}

function firstConflict(groups: Occupancy[][], starts: number[]): [Occupancy, Occupancy] | null {
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      for (const b of group.slice(i + 1)) {
        if ((a.taskId && b.holdMembers?.has(a.taskId))
          || (b.taskId && a.holdMembers?.has(b.taskId))) continue;
        if (starts[a.startTask] < starts[b.endTask] + b.endDuration
          && starts[b.startTask] < starts[a.endTask] + a.endDuration) {
          return [a, b];
        }
      }
    }
  }
  return null;
}

function summarize(procedure: SchedulingProcedure, tasks: ScheduledTask[], searchNodes: number): CookingSchedule {
  const elapsedSec = -Math.min(...tasks.map(task => task.startSec));
  const handsOn = new Set(procedure.tasks.filter(task => task.attention === "hands-on").map(task => task.id));
  const occupied = tasks.filter(task => handsOn.has(task.id));
  const freeAttentionIntervals: AttentionInterval[] = [];
  let cursor = -elapsedSec;
  for (const task of occupied) {
    if (task.startSec > cursor) freeAttentionIntervals.push({ startSec: cursor, endSec: task.startSec });
    cursor = Math.max(cursor, task.endSec);
  }
  if (cursor < 0) freeAttentionIntervals.push({ startSec: cursor, endSec: 0 });
  return {
    elapsedSec,
    handsOnSec: occupied.reduce((total, task) => total + task.endSec - task.startSec, 0),
    freeAttentionIntervals,
    tasks,
    searchNodes,
  };
}

/**
 * Static preview only. Call validateProcedure(input, trustedContext) first;
 * parsing here is defensive and cannot authenticate a review attestation.
 *
 * Uses reviewed maximum durations, backward difference constraints and bounded
 * branching on exclusive-resource order. A result is feasible, not necessarily
 * shortest. Search exhaustion never becomes a claim of culinary impossibility.
 */
export function scheduleProcedure(procedure: CookingProcedure, options: ScheduleOptions = {}): ScheduleResult {
  const parsed = cookingProcedureSchema.safeParse(procedure);
  if (!parsed.success) return { ok: false, reason: "unsupported", message: "The procedure is outside the supported version 1 schema", searchNodes: 0 };
  return solveProcedure(parsed.data, options);
}

/** Explicitly unreviewed, source-bound pilot. Reuses the same graph checks,
 * solver and output validation without manufacturing a review attestation. */
export function scheduleExperimentalProcedure(input: unknown, context: unknown, options: ScheduleOptions = {}): ScheduleResult {
  const validated = validateExperimentalProcedure(input, context);
  if (!validated.ok) return { ok: false, reason: "unsupported", searchNodes: 0,
    message: validated.issues.map(issue => `${issue.path}: ${issue.message}`).join("; ") };
  return solveProcedure(validated.procedure, options);
}

function solveProcedure(procedure: SchedulingProcedure, options: ScheduleOptions): ScheduleResult {
  const unsupported = (message: string, searchNodes = 0): ScheduleResult =>
    ({ ok: false, reason: "unsupported", message, searchNodes });
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return unsupported("Scheduling options must be an object");
  }
  const budget = options.maxSearchNodes ?? DEFAULT_SEARCH_NODES;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_SEARCH_NODES) {
    return unsupported(`maxSearchNodes must be an integer from 1 to ${MAX_SEARCH_NODES}`);
  }
  const available = options.availableSeconds;
  if (available !== undefined && (!Number.isSafeInteger(available) || available < 0)) {
    return unsupported("availableSeconds must be a nonnegative safe integer");
  }

  const ordered = [...procedure.tasks].sort((a, b) => compare(a.id, b.id));
  const index = new Map(ordered.map((task, i) => [task.id, i]));
  const serve = index.get(procedure.serveTaskId);
  if (serve === undefined || index.size !== ordered.length) {
    return unsupported("A unique task graph and serving task must be validated first");
  }
  const anchor = ordered.length;
  const base: Edge[] = [
    { from: anchor, to: serve, weight: -ordered[serve].duration.maxSeconds },
    { from: serve, to: anchor, weight: ordered[serve].duration.maxSeconds },
  ];
  const groups = new Map<string, Occupancy[]>([["cook", []]]);
  for (const resource of procedure.resources) groups.set(`equipment:${resource.id}`, []);
  for (let i = 0; i < ordered.length; i++) {
    const task = ordered[i];
    const occupancy: Occupancy = {
      key: `task:${task.id}`, taskId: task.id, startTask: i, endTask: i,
      endDuration: task.duration.maxSeconds,
    };
    if (task.attention === "hands-on") groups.get("cook")!.push(occupancy);
    for (const resource of task.resourceIds) {
      const group = groups.get(`equipment:${resource}`);
      if (!group) return unsupported("Task equipment must be validated first");
      group.push(occupancy);
    }
    for (const dependency of task.dependencies) {
      const prior = index.get(dependency.taskId);
      if (prior === undefined) return unsupported("Task dependencies must be validated first");
      base.push({ from: i, to: prior, weight: -ordered[prior].duration.maxSeconds - dependency.minWaitSeconds });
      base.push({ from: prior, to: i, weight: ordered[prior].duration.maxSeconds + dependency.maxWaitSeconds });
    }
  }
  for (const hold of procedure.resourceHolds) {
    const startTask = index.get(hold.startTaskId);
    const endTask = index.get(hold.endTaskId);
    const group = groups.get(`equipment:${hold.resourceId}`);
    if (startTask === undefined || endTask === undefined || !group) {
      return unsupported("Resource holds must be validated first");
    }
    group.push({
      key: `hold:${hold.id}`, startTask, endTask,
      endDuration: ordered[endTask].duration.maxSeconds, holdMembers: new Set(hold.taskIds),
    });
  }
  for (const containment of procedure.containments ?? []) {
    const process = index.get(containment.processTaskId), activity = index.get(containment.activityTaskId);
    if (process === undefined || activity === undefined || process === activity) return unsupported("Task containment endpoints must be validated first");
    // start(process) <= start(activity), end(activity) <= end(process).
    base.push({ from: activity, to: process, weight: 0 });
    base.push({ from: process, to: activity, weight: ordered[process].duration.maxSeconds - ordered[activity].duration.maxSeconds });
  }
  const conflicts = [...groups.entries()].sort(([a], [b]) => compare(a, b))
    .map(([, group]) => group.sort((a, b) => compare(a.key, b.key)));
  const pending: Branch[] = [{}];
  let searchNodes = 0;
  let best: CookingSchedule | undefined;
  let outsideHorizon = false;

  while (pending.length && searchNodes < budget) {
    const branch = pending.pop()!;
    searchNodes++;
    const starts = latestStarts(base, branch, ordered.length);
    if (!starts) continue;
    if (starts.some(start => !Number.isFinite(start))) {
      return unsupported("Every task must lead to the terminal serving task", searchNodes);
    }
    const elapsed = -Math.min(...starts);
    if (elapsed > MAX_TIMELINE_SECONDS) {
      outsideHorizon = true;
      continue;
    }
    // Once a feasible estimate exists, only explore branches that could meet
    // the requested time. Extra ordering constraints can only move starts back.
    if (best && available !== undefined && elapsed > available) continue;
    const conflict = firstConflict(conflicts, starts);
    if (conflict) {
      let [a, b] = conflict;
      if (starts[a.startTask] > starts[b.startTask]
        || (starts[a.startTask] === starts[b.startTask] && compare(a.key, b.key) > 0)) [a, b] = [b, a];
      // Explore the earlier current start first; retain the opposite ordering.
      pending.push({ parent: branch, edge: { from: a.startTask, to: b.endTask, weight: -b.endDuration } });
      pending.push({ parent: branch, edge: { from: b.startTask, to: a.endTask, weight: -a.endDuration } });
      continue;
    }
    const tasks = ordered.map((task, i) => ({
      id: task.id, startSec: starts[i], endSec: starts[i] + task.duration.maxSeconds,
    })).sort((a, b) => a.startSec - b.startSec || compare(a.id, b.id));
    const check = validateSchedule(procedure, { tasks });
    if (!check.ok) return unsupported(`Schedule validation failed: ${check.issues.join("; ")}`, searchNodes);
    const schedule = summarize(procedure, tasks, searchNodes);
    if (available === undefined || schedule.elapsedSec <= available) return { ok: true, ...schedule };
    if (!best || schedule.elapsedSec < best.elapsedSec) best = schedule;
  }
  if (pending.length) {
    return {
      ok: false, reason: "search_limit", searchNodes,
      message: "The bounded search stopped before finding a schedule within the requested constraints",
      ...(best ? { requiredSeconds: best.elapsedSec } : {}),
    };
  }
  if (best) {
    return {
      ok: false, reason: "too_late", searchNodes, requiredSeconds: best.elapsedSec,
      message: "The available time is shorter than this conservative schedule estimate; task durations were not shortened",
    };
  }
  if (outsideHorizon) return unsupported("No schedule was found within the supported 24-hour horizon", searchNodes);
  return {
    ok: false, reason: "no_schedule_found", searchNodes,
    message: "No schedule was found for these fixed maximum durations and reviewed constraints; this does not prove the recipe impossible",
  };
}
