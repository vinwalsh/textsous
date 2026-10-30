"use client";

import { useMemo } from "react";
import type { TimelineDefinition } from "../lib/schema/timeline";
import { schedule } from "../lib/scheduler/schedule";

/** Lane rows with task bars placed by the deterministic schedule. */
export default function TimelineView({ timeline }: { timeline: TimelineDefinition }) {
  const sched = useMemo(() => {
    try {
      return schedule(timeline);
    } catch {
      return null;
    }
  }, [timeline]);

  if (!sched) return <p className="meta">This timeline could not be laid out.</p>;

  const placed = new Map(sched.tasks.map((t) => [t.id, t] as const));
  const total = Math.max(1, sched.totalMinutes);

  return (
    <div>
      <p className="meta">About {sched.totalMinutes} minutes from prep to serving.</p>
      <div
        className="lanes"
        role="img"
        aria-label={`Cooking timeline, ${sched.totalMinutes} minutes across ${timeline.lanes.length} lanes`}
      >
        {timeline.lanes.map((lane) => (
          <div key={lane.id} className="lane-row">
            <div className="lane-label" title={lane.label}>
              <span className="lane-dot" style={{ backgroundColor: lane.color }} aria-hidden="true" />
              <span>{lane.label}</span>
            </div>
            <div className="lane-track">
              {timeline.tasks
                .filter((t) => t.laneIds[0] === lane.id)
                .map((task) => {
                  const slot = placed.get(task.id);
                  const start = slot?.startMinutes ?? 0;
                  const span = slot ? slot.endMinutes - slot.startMinutes : task.minutes;
                  return (
                    <div
                      key={task.id}
                      className={task.attention === "hands-on" ? "lane-bar" : "lane-bar unattended"}
                      style={{
                        left: `${(start / total) * 100}%`,
                        width: `${Math.max(2, (span / total) * 100)}%`,
                      }}
                      title={`${task.label} (${start}–${start + span} min)`}
                    >
                      {task.label}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
        <div className="axis" aria-hidden="true">
          <span>0m</span>
          <span>{sched.totalMinutes}m</span>
        </div>
      </div>
      <p className="meta">
        Solid bars need you at the stove; striped bars look after themselves.{" "}
        {timeline.tasks.filter((t) => t.laneIds.length > 1).length > 0
          ? "Shared tasks are shown in their first lane."
          : ""}
      </p>
    </div>
  );
}
