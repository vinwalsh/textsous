"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { ChevronRight, Clock3, Utensils } from "lucide-react";
import type { CookingPlan, CookingScheduledTask } from "@/lib/cooking-pilot/plan";
import { buildTimelineGeometry, packTimelineOverlapGroups } from "@/lib/cooking-pilot/timeline-layout";
import styles from "./compact-cooking-timeline.module.css";

export interface CompactCookingTimelineProps {
  plan: CookingPlan;
  guideMinutes: number;
  hasStarted: boolean;
  isRunning: boolean;
  selectedTask: string | null;
  renderTaskTimer: (task: CookingScheduledTask) => ReactNode;
  onSelectTask: (taskId: string, trigger: HTMLButtonElement) => void;
  chartRef: Ref<HTMLDivElement>;
  headerRef?: Ref<HTMLDivElement>;
}

const phaseLabels: Record<string, string> = { prep: "Mise en Place", cook: "Cooking", plate: "Finish & serve", finish: "Finish & serve" };
const duration = (task: CookingScheduledTask) => `${task.range && task.range.min !== task.range.max
  ? `${task.range.min}–${task.range.max}` : task.minutes} min${task.adjustedFromMinutes !== undefined ? " · your time" : task.timingBasis === "estimate" ? " · estimate" : ""}`;
const elapsedLabel = (minutes: number) => {
  const seconds = Math.max(0, Math.floor(minutes * 60));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
type Decoration = { id: string; minute: number; height: number; kind: "phase" | "parallel" | "serve"; label?: string };

/** All intervals and the horizontal guide use one continuous time mapping.
 * Header space is excluded from time; shared work renders once. Task timers and
 * cooking state remain parent-owned, including timers in folded parallel pairs. */
export function CompactCookingTimeline({ plan, guideMinutes, hasStarted, isRunning, selectedTask,
  renderTaskTimer, onSelectTask, chartRef, headerRef }: CompactCookingTimelineProps) {
  const contentNodes = useRef(new Map<string, HTMLDivElement>());
  const taskButtons = useRef(new Map<string, HTMLButtonElement>());
  const [minimumHeights, setMinimumHeights] = useState<Record<string, number>>({});
  const [pairByGroup, setPairByGroup] = useState<Record<string, number>>({});
  const groups = useMemo(() => packTimelineOverlapGroups(plan.tasks), [plan]);
  const geometry = useMemo(() => buildTimelineGeometry(plan, { minimumTaskHeight: minimumHeights }), [plan, minimumHeights]);
  const tasksById = useMemo(() => new Map(plan.tasks.map(task => [task.id, task])), [plan]);
  const elapsed = hasStarted ? Math.max(0, guideMinutes) : 0;
  const isCurrent = (task: CookingScheduledTask) => hasStarted && elapsed >= task.startMinute && elapsed < task.endMinute;
  const decorations = useMemo(() => {
    const entries: Decoration[] = plan.phaseSpans.map(span => ({ id: span.phaseId, minute: span.startMinute, height: 44,
      kind: "phase", label: phaseLabels[span.phaseId] ?? plan.phases.find(phase => phase.id === span.phaseId)?.label ?? span.phaseId }));
    for (const group of groups.filter(item => item.columnCount > 2)) entries.push({ id: group.id, minute: group.startMinute,
      height: 66 + Math.ceil(Math.ceil(group.columnCount / 2) / 3) * 48, kind: "parallel" });
    // A full-width serving heading can occupy non-time space only when it does
    // not cut through a still-running optional interval.
    if (!plan.tasks.some(task => task.startMinute < plan.serveMinute && task.endMinute > plan.serveMinute)) {
      entries.push({ id: "serving", minute: plan.serveMinute, height: 60, kind: "serve" });
    }
    const order = { phase: 0, parallel: 1, serve: 2 };
    return entries.sort((a, b) => a.minute - b.minute || order[a.kind] - order[b.kind]);
  }, [plan, groups]);
  const position = (minute: number, beforeHeading = false) => geometry.position(minute)
    + decorations.filter(item => item.minute < minute || (!beforeHeading && item.minute === minute)).reduce((sum, item) => sum + item.height, 0);
  const displayItems = [
    ...decorations.map((decoration, index) => ({ kind: "decoration" as const, decoration, index, minute: decoration.minute, order: index })),
    ...groups.map(group => ({ kind: "group" as const, group, minute: group.startMinute, order: decorations.length })),
  ].sort((a, b) => a.minute - b.minute || a.order - b.order);

  useEffect(() => {
    // Measure natural content rather than the allocated interval box. Keep the
    // largest observed size so ticking digits cannot make the timeline jitter.
    const measure = (nodes: readonly HTMLDivElement[]) => setMinimumHeights(previous => {
      const next = { ...previous };
      let changed = false;
      for (const node of nodes) {
        const taskId = node.dataset.taskMeasurement;
        const height = Math.ceil(node.getBoundingClientRect().height) + 10;
        if (taskId && height > (Object.hasOwn(previous, taskId) ? previous[taskId] : 220)) { next[taskId] = height; changed = true; }
      }
      return changed ? next : previous;
    });
    const nodes = [...contentNodes.current.values()];
    const observer = new ResizeObserver(entries => measure(entries.map(entry => entry.target as HTMLDivElement)));
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [plan, pairByGroup]);

  function choosePair(groupId: string, pair: number) {
    const selected = selectedTask ? taskButtons.current.get(selectedTask) : undefined;
    if (selected && selectedTask) onSelectTask(selectedTask, selected);
    setPairByGroup(previous => ({ ...previous, [groupId]: pair }));
  }

  return <div className={styles.compact} ref={chartRef} role="region" aria-label="Compact cooking timeline">
    <div className={styles.header} ref={headerRef}>
      <p>Steps side by side happen together. Tap a step for details; start its timer whenever you need it.</p>
      <span>{hasStarted ? `${isRunning ? "Guide elapsed" : "Guide paused"} · ${elapsedLabel(elapsed)}` : "Ready when you are"}</span>
    </div>
    <div className={styles.board} style={{ height: position(plan.totalMinutes) + 52 }}>
      {displayItems.map(item => {
        if (item.kind === "decoration") {
        const { decoration, index } = item;
        const top = geometry.position(decoration.minute) + decorations.slice(0, index).reduce((sum, item) => sum + item.height, 0);
        if (decoration.kind === "phase") return <h3 className={styles.phase} key={`phase-${decoration.id}`}
          style={{ top, height: decoration.height }} data-phase-heading={decoration.id}>{decoration.label}</h3>;
        if (decoration.kind === "serve") return <div className={styles.serving} key="serving" data-serving-estimate style={{ top, height: decoration.height }}>
          <Utensils size={16} aria-hidden="true" /><span><strong>Serving estimate</strong><small>Check the food before serving.</small></span>
        </div>;
        const group = groups.find(item => item.id === decoration.id)!;
        const pair = Math.min(pairByGroup[group.id] ?? 0, Math.ceil(group.columnCount / 2) - 1);
        return <div className={styles.parallelPicker} key={`parallel-${group.id}`} style={{ top, height: decoration.height }}>
          <p>{group.columnCount} parallel steps. Choose a pair to view.</p>
          <div role="group" aria-label="Parallel steps">{Array.from({ length: Math.ceil(group.columnCount / 2) }, (_, index) => {
            const active = group.placements.filter(item => Math.floor(item.column / 2) === index && isCurrent(tasksById.get(item.taskId)!)).length;
            return <button type="button" key={index} aria-pressed={pair === index} aria-controls={group.id} onClick={() => choosePair(group.id, index)}>
              {index * 2 + 1}–{Math.min(group.columnCount, index * 2 + 2)}{active > 0 && <small>{active} at guide</small>}
            </button>;
          })}</div>
        </div>;
        }
        const group = item.group;
        const pair = Math.min(pairByGroup[group.id] ?? 0, Math.ceil(group.columnCount / 2) - 1);
        const columns = Math.min(2, group.columnCount);
        const top = position(group.startMinute);
        return <section key={group.id} id={group.id} className={styles.overlapGroup} data-columns={columns}
          style={{ top, height: position(group.endMinute, true) - top }} aria-label={group.columnCount > 1 ? "Overlapping cooking steps" : "Cooking step"}>
          {group.placements.map(placement => {
            const task = tasksById.get(placement.taskId)!;
            const column = placement.column % 2;
            const current = isCurrent(task);
            const shown = Math.floor(placement.column / 2) === pair;
            const taskTop = position(task.startMinute);
            const timer = renderTaskTimer(task);
            return <article key={task.id} className={styles.task}
              onClick={event => {
                // The real button remains the keyboard/detail-dialog anchor.
                // Padding opens the same details without stealing timer clicks.
                if (event.defaultPrevented || !(event.target instanceof Element)
                  || event.target.closest("button, a, input, select, textarea, summary, dialog, [role='button'], [contenteditable='true']")) return;
                const trigger = taskButtons.current.get(task.id);
                if (trigger) onSelectTask(task.id, trigger);
              }}
              data-task-id={task.id} data-start-minute={task.startMinute} data-end-minute={task.endMinute}
              data-guide-current={current} data-past={hasStarted && elapsed >= task.endMinute} data-phase={task.phase}
              data-lane={task.laneIds[0]} data-shared={task.laneIds.length > 1} data-minutes={task.minutes}
              data-selected={selectedTask === task.id} aria-hidden={!shown} inert={!shown}
              style={{ top: taskTop - top + 4, height: position(task.endMinute, true) - taskTop - 8,
                left: columns === 1 ? 0 : `calc(${column * 50}% + ${column * 4}px)`, width: columns === 1 ? "100%" : "calc(50% - 4px)",
                visibility: shown ? "visible" : "hidden",
                "--step-color": plan.lanes.find(lane => lane.id === task.laneIds[0])?.color ?? "#587454" } as CSSProperties}>
              <div className={styles.contentTrack} style={task.checkpoints?.length
                ? { height: position(task.startMinute + task.checkpoints[0].afterMinutes, true) - taskTop - 30 } : undefined}>
              <div className={styles.cardContent} data-task-measurement={task.id}
                ref={node => { if (node) contentNodes.current.set(task.id, node); else contentNodes.current.delete(task.id); }}>
                <button type="button" className={styles.detailButton} data-task-detail-button={task.id}
                  ref={node => { if (node) taskButtons.current.set(task.id, node); else taskButtons.current.delete(task.id); }}
                  onClick={event => onSelectTask(task.id, event.currentTarget)}
                  aria-haspopup="dialog" aria-expanded={selectedTask === task.id} aria-controls={selectedTask === task.id ? "timeline-step-detail" : undefined}>
                  <span className={styles.taskHeading}><strong>{task.label}</strong><ChevronRight size={17} aria-hidden="true" /></span>
                  <span className={styles.chips}>{task.laneIds.map(laneId => {
                    const lane = plan.lanes.find(item => item.id === laneId);
                    return <span key={laneId}><i style={{ background: lane?.color ?? "#587454" }} aria-hidden="true" />{lane?.label ?? laneId}</span>;
                  })}</span>
                  <span className={styles.duration}><Clock3 size={12} aria-hidden="true" />{duration(task)}</span>
                  <span className={styles.taskMeta}>{task.optional ? "Optional" : task.attention === "hands-on" ? "Hands-on" : "While it cooks"}
                    {task.laneIds.length > 1 && " · shared step"}{task.deferredUntilAfterServing && " · after serving"}</span>
                </button>
                {timer && <div className={styles.taskTimer}>{timer}</div>}
              </div>
              </div>
              {task.checkpoints?.map(point => <span className={styles.checkpoint} key={point.afterMinutes}
                title={point.label} aria-label={`Check at ${point.afterMinutes} minutes: ${point.label}`}
                style={{ top: position(task.startMinute + point.afterMinutes, true) - taskTop - 4 }}>
                Check at {point.afterMinutes} min
              </span>)}
            </article>;
          })}
        </section>;
      })}
      {!decorations.some(item => item.kind === "serve") && <div className={styles.servingMark} data-serving-estimate
        style={{ top: position(plan.serveMinute) }}><span>Serving estimate</span></div>}
      {hasStarted && <div className={`${styles.guideLine} ${!isRunning ? styles.paused : ""}`} role="img" aria-label="Timeline guide position"
        data-guide-line data-guide-minute={elapsed} style={{ top: position(Math.min(elapsed, plan.totalMinutes + 1)) }}>
        <span>{isRunning ? "Now" : "Paused"} · {elapsedLabel(elapsed)}{elapsed > plan.totalMinutes + 1 ? " ↓" : ""}</span>
      </div>}
    </div>
    {hasStarted && elapsed >= plan.serveMinute && <p className={styles.afterEstimate}>Past the serving estimate. Check the food and take the time you need.</p>}
  </div>;
}
