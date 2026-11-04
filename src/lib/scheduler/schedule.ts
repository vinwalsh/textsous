import type { TimelineDefinition, TimelineTask } from "../schema/timeline";

export const SCHEDULER_VERSION = 1;

export interface ScheduledTask {
  id: string;
  startMinutes: number;
  endMinutes: number;
}

export interface ScheduleResult {
  /** One entry per task, in timeline order. */
  tasks: ScheduledTask[];
  /** Task ids of the longest dependency chain by minutes. */
  criticalPath: string[];
  totalMinutes: number;
}

/**
 * Deterministic topological order: Kahn's algorithm with input-order
 * tie-breaks. Throws on dependency cycles and dangling references.
 */
function topoOrder(tasks: TimelineTask[]): TimelineTask[] {
  const byId = new Map<string, TimelineTask>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`schedule: duplicate task id "${task.id}"`);
    byId.set(task.id, task);
  }
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, 0);
    outgoing.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!byId.has(dep)) throw new Error(`schedule: task "${task.id}" depends on unknown "${dep}"`);
      if (dep === task.id) throw new Error(`schedule: task "${task.id}" depends on itself`);
      outgoing.get(dep)?.push(task.id);
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
    }
  }
  const indexOf = new Map(tasks.map((t, i) => [t.id, i] as const));
  const ready = tasks.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  const order: TimelineTask[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
    const id = ready.shift() as string;
    order.push(byId.get(id) as TimelineTask);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (order.length !== tasks.length) {
    const stuck = tasks.map((t) => t.id).filter((id) => !order.some((t) => t.id === id));
    throw new Error(`schedule: dependency cycle involving ${stuck.join(", ")}`);
  }
  return order;
}

function waitMinutes(task: TimelineTask): number {
  return task.scheduling.waits.reduce((a, w) => a + w, 0) / 60;
}

/** Ids of the tasks that turn the oven on (the preheat). */
export function ovenOnTaskIds(tasks: readonly TimelineTask[]): Set<string> {
  return new Set(tasks.filter((t) => t.equipmentEvent === "oven-on").map((t) => t.id));
}

/**
 * Earliest start that a task's dependencies and waits allow, with the
 * dependency that sets it. Waits count from the last dependency, except on a
 * task that depends on an oven-on (preheat) task: there the wait is the oven
 * heating up, so it counts from the preheat's end while the cook keeps
 * working, and the task still starts only after every dependency ends.
 * Shared by the scheduler and the review's task_schedule check.
 */
export function readyAfter(
  task: TimelineTask,
  endOf: (id: string) => number | undefined,
  ovenOnIds: ReadonlySet<string>,
): { at: number; via: string | null } {
  const wait = waitMinutes(task);
  const ovenDeps = wait > 0 ? task.dependencies.filter((d) => ovenOnIds.has(d)) : [];
  let at = task.dependencies.length === 0 ? wait : 0;
  let via: string | null = null;
  for (const dep of task.dependencies) {
    const waited = ovenDeps.length === 0 || ovenDeps.includes(dep) ? wait : 0;
    const ready = (endOf(dep) ?? 0) + waited;
    if (ready > at) {
      at = ready;
      via = dep;
    }
  }
  return { at, via };
}

/**
 * Deterministic list scheduler. Rules, in force order:
 * - dependencies and resource holds are never violated;
 * - one cook: hands-on tasks never overlap, unattended tasks overlap freely;
 * - every prep task ends before the first cook task starts;
 * - the serve task starts after every other task ends.
 * Waits are seconds of idle time before the task starts: after its
 * dependencies complete, or after the preheat for the oven heat-up (see
 * readyAfter). The model never schedules: start/end minutes come only from here.
 */
export function schedule(timeline: TimelineDefinition): ScheduleResult {
  const tasks = timeline.tasks;
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  if (!byId.has(timeline.serveTaskId)) {
    throw new Error(`schedule: serveTaskId "${timeline.serveTaskId}" is not a task`);
  }
  for (const task of tasks) {
    if (task.phase === "prep" && task.dependencies.some((d) => byId.get(d)?.phase !== "prep")) {
      throw new Error(`schedule: prep task "${task.id}" depends on a non-prep task`);
    }
  }
  const order = topoOrder(tasks);

  // Holds come from the top-level list plus per-task scheduling entries.
  const held = new Map<string, Set<string>>();
  for (const task of tasks) held.set(task.id, new Set(task.scheduling.resourceIds));
  for (const hold of timeline.resourceHolds) {
    if (!byId.has(hold.taskId)) {
      throw new Error(`schedule: hold references unknown task "${hold.taskId}"`);
    }
    held.get(hold.taskId)?.add(hold.resourceId);
  }
  const ovenOn = ovenOnTaskIds(tasks);

  const start = new Map<string, number>();
  const end = new Map<string, number>();
  const resourceFreeAt = new Map<string, number>();
  let cookFreeAt = 0;

  const place = (task: TimelineTask, notBefore: number): void => {
    const ready = readyAfter(task, (id) => end.get(id), ovenOn).at;
    const heldFree = Math.max(0, ...[...(held.get(task.id) ?? [])].map((r) => resourceFreeAt.get(r) ?? 0));
    let taskStart = Math.max(ready, notBefore, heldFree);
    if (task.attention === "hands-on") taskStart = Math.max(taskStart, cookFreeAt);
    const taskEnd = taskStart + task.minutes;
    start.set(task.id, taskStart);
    end.set(task.id, taskEnd);
    if (task.attention === "hands-on") cookFreeAt = taskEnd;
    for (const resource of held.get(task.id) ?? []) resourceFreeAt.set(resource, taskEnd);
  };

  // Prep first, so prepEnd is known before any cook task is placed.
  const serveId = timeline.serveTaskId;
  const rest = order.filter((t) => t.id !== serveId);
  for (const task of rest.filter((t) => t.phase === "prep")) place(task, 0);
  const prepEnd = Math.max(0, ...rest.filter((t) => t.phase === "prep").map((t) => end.get(t.id) ?? 0));
  for (const task of rest.filter((t) => t.phase !== "prep")) {
    place(task, task.phase === "cook" ? prepEnd : 0);
  }
  const serve = byId.get(serveId) as TimelineTask;
  const othersEnd = Math.max(0, ...rest.map((t) => end.get(t.id) ?? 0));
  place(serve, othersEnd);

  // Critical path: longest dependency chain by minutes, waits included the
  // same way the scheduler counts them.
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const task of order) {
    const ready = readyAfter(task, (id) => dist.get(id), ovenOn);
    dist.set(task.id, ready.at + task.minutes);
    prev.set(task.id, ready.via);
  }
  let tip: string | null = null;
  for (const task of order) {
    if (tip === null || (dist.get(task.id) ?? 0) > (dist.get(tip) ?? 0)) tip = task.id;
  }
  const criticalPath: string[] = [];
  for (let cur = tip; cur !== null; cur = prev.get(cur) ?? null) criticalPath.unshift(cur);

  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      startMinutes: start.get(t.id) ?? 0,
      endMinutes: end.get(t.id) ?? 0,
    })),
    criticalPath,
    totalMinutes: Math.max(0, ...tasks.map((t) => end.get(t.id) ?? 0)),
  };
}
