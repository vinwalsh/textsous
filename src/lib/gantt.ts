import type { TimelineDefinition } from "./schema/timeline";
import type { ScheduleResult } from "./scheduler/schedule";

/**
 * One-line-per-task text Gantt: 1 char per minute, `#` for hands-on work,
 * `=` for unattended intervals, bars padded to the total width. Pure.
 */
export function renderGantt(
  title: string,
  timeline: TimelineDefinition,
  schedule: ScheduleResult,
): string {
  const lines = [`${title} — ${schedule.totalMinutes}m total`];
  const width = schedule.totalMinutes;
  const laneOf = new Map(timeline.lanes.map((l) => [l.id, l.label] as const));
  const placed = new Map(schedule.tasks.map((t) => [t.id, t] as const));
  for (const task of timeline.tasks) {
    const slot = placed.get(task.id);
    const start = slot?.startMinutes ?? 0;
    const minutes = task.minutes;
    const mark = task.attention === "hands-on" ? "#" : "=";
    const bar = `${" ".repeat(start)}${mark.repeat(minutes)}`.padEnd(width, " ");
    const lanes = task.laneIds.map((id) => laneOf.get(id) ?? id).join(" + ");
    lines.push(
      `${String(start).padStart(3)}-${String(start + minutes).padEnd(3)} [${bar}] ${task.label} (${task.phase}, ${task.attention}; ${lanes})`,
    );
  }
  return lines.join("\n");
}
