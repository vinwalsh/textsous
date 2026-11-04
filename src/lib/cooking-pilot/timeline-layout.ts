import type { CookingScheduledTask } from "./plan";

type Interval = Pick<CookingScheduledTask, "id" | "startMinute" | "endMinute">;
const DEFAULT_TASK_HEIGHT = 220;
const DEFAULT_PIXELS_PER_MINUTE = 12;
/** A check's label below its line on a card, with the card's bottom margin. */
const CHECK_LABEL_HEIGHT = 36;

function orderedIntervals(tasks: readonly Interval[]) {
  if (!tasks.length || new Set(tasks.map(task => task.id)).size !== tasks.length
    || tasks.some(task => !Number.isFinite(task.startMinute) || !Number.isFinite(task.endMinute)
      || task.startMinute < 0 || task.endMinute <= task.startMinute)) throw new Error("Invalid timeline intervals");
  return [...tasks].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.id.localeCompare(b.id));
}

export interface TimelineGeometryOptions {
  minimumTaskHeight?: number | Readonly<Record<string, number>>;
  baselinePixelsPerMinute?: number;
}

/** Shared continuous time geometry, without presentation heading space.
 * Each interval receives enough height for its content. A longest-path pass
 * through ordered time boundaries retains every overlap and compresses spare
 * time; cards and the guide must both use position(), never separate scales. */
export function buildTimelineGeometry(plan: { tasks: readonly (Interval & Pick<CookingScheduledTask, "checkpoints">)[]; totalMinutes: number }, options: TimelineGeometryOptions = {}) {
  const tasks = orderedIntervals(plan.tasks);
  const baseline = options.baselinePixelsPerMinute ?? DEFAULT_PIXELS_PER_MINUTE;
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(plan.totalMinutes)
    || plan.totalMinutes < Math.max(...tasks.map(task => task.endMinute))) throw new Error("Invalid timeline geometry limits");
  const minimum = (taskId: string) => {
    const supplied = options.minimumTaskHeight;
    const value = typeof supplied === "number" ? supplied
      : supplied && Object.hasOwn(supplied, taskId) ? supplied[taskId] : DEFAULT_TASK_HEIGHT;
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid minimum task height");
    return value;
  };
  const constraints = tasks.map(task => ({ start: task.startMinute, end: task.endMinute, height: minimum(task.id) }));
  for (const task of plan.tasks) {
    let prior = task.startMinute;
    for (const [index, point] of (task.checkpoints ?? []).entries()) {
      const minute = task.startMinute + point.afterMinutes;
      if (!Number.isFinite(minute) || minute <= prior || minute > task.endMinute) throw new Error("Invalid timeline checkpoint");
      // Keep the actual instruction/timer content above its first checkpoint.
      constraints.push({ start: prior, end: minute, height: index === 0 ? minimum(task.id) + 28 : 28 });
      prior = minute;
    }
    // Room under the last check for its label ("Check at 7 min"), which hangs
    // below the line: a check a minute before the end is not clipped.
    if (prior > task.startMinute && prior < task.endMinute) constraints.push({ start: prior, end: task.endMinute, height: CHECK_LABEL_HEIGHT });
  }
  const minutes = [...new Set([0, plan.totalMinutes, ...constraints.flatMap(item => [item.start, item.end])])].sort((a, b) => a - b);
  const yByMinute = new Map<number, number>([[0, 0]]);
  for (let index = 1; index < minutes.length; index++) {
    const minute = minutes[index], prior = minutes[index - 1];
    let y = yByMinute.get(prior)! + (minute - prior) * baseline;
    for (const constraint of constraints.filter(item => item.end === minute)) {
      y = Math.max(y, yByMinute.get(constraint.start)! + constraint.height);
    }
    yByMinute.set(minute, y);
  }
  const boundaries = minutes.map(minute => ({ minute, y: yByMinute.get(minute)! }));
  const segments = boundaries.slice(1).map((boundary, index) => ({
    startMinute: boundaries[index].minute, endMinute: boundary.minute,
    top: boundaries[index].y, height: boundary.y - boundaries[index].y,
  }));
  const totalHeight = yByMinute.get(plan.totalMinutes)!;
  const position = (minute: number) => {
    if (!Number.isFinite(minute)) throw new Error("Invalid timeline minute");
    if (minute <= 0) return 0;
    if (minute >= plan.totalMinutes) return totalHeight + (minute - plan.totalMinutes) * baseline;
    const segment = segments.find(item => minute >= item.startMinute && minute < item.endMinute)!;
    return segment.top + (minute - segment.startMinute) / (segment.endMinute - segment.startMinute) * segment.height;
  };
  return { boundaries, segments, totalHeight, position };
}

export interface TimelineOverlapGroup {
  id: string;
  startMinute: number;
  endMinute: number;
  columnCount: number;
  placements: { taskId: string; column: number; startMinute: number; endMinute: number }[];
}

/** Half-open intervals: a task that starts when another ends can reuse its
 * column. Connected groups reset to full width once concurrent work ends. */
export function packTimelineOverlapGroups(tasks: readonly Interval[]): TimelineOverlapGroup[] {
  const groups: TimelineOverlapGroup[] = [];
  let columnEnds: number[] = [];
  for (const task of orderedIntervals(tasks)) {
    let group = groups.at(-1);
    if (!group || task.startMinute >= group.endMinute) {
      group = { id: `overlap-${task.id}`, startMinute: task.startMinute, endMinute: task.endMinute, columnCount: 0, placements: [] };
      groups.push(group);
      columnEnds = [];
    }
    let column = columnEnds.findIndex(end => end <= task.startMinute);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = task.endMinute;
    group.endMinute = Math.max(group.endMinute, task.endMinute);
    group.columnCount = columnEnds.length;
    group.placements.push({ taskId: task.id, column, startMinute: task.startMinute, endMinute: task.endMinute });
  }
  return groups;
}
