"use client";

import { Fragment, useMemo, useState } from "react";
import type { ArtifactChange, CookAlongArtifact } from "../lib/schema/artifact";
import type { Lane, TimelineTask } from "../lib/schema/timeline";
import { buildImportUrl, saveToTextSousEnabled } from "../lib/handoff";
import { applyArtifactAllergenFloor, rollUpTraces } from "../lib/allergens";
import { laneDisplayColors, taskLaneColor } from "../lib/lane-palette";
import { mergeNotes, reviewNoteTexts } from "../lib/review-notes";
import { schedule } from "../lib/scheduler/schedule";
import ErrorBox from "./ErrorBox";
import { apiFetch, friendlyError, type FriendlyError } from "./request";
import AdjustPanel from "./AdjustPanel";
import TimelineView from "./TimelineView";
import Timer from "./Timer";

const CHANGE_LABELS: Record<ArtifactChange["kind"], string> = {
  "merged-steps": "Steps merged",
  estimate: "Estimated timing",
  scale: "Scaled",
  swap: "Swapped",
  technique: "Technique",
};

function Credit({ artifact }: { artifact: CookAlongArtifact }) {
  const credit = artifact.recipe.credit;
  return (
    <div className="card" aria-label="Recipe credit">
      {credit.kind === "url" ? (
        <p>
          From <strong>{credit.site ?? "an unknown site"}</strong>
          {credit.author ? ` by ${credit.author}` : ""}{" "}
          {credit.url ? (
            <a href={credit.url} target="_blank" rel="noreferrer">
              View original
            </a>
          ) : null}
        </p>
      ) : credit.kind === "photo" ? (
        <p>
          Photo from <strong>{credit.book ?? "an unknown book"}</strong>
          {credit.author ? ` by ${credit.author}` : ""}
          {credit.page ? `, page ${credit.page}` : ""}
        </p>
      ) : (
        <p>Pasted text — no external source.</p>
      )}
      {credit.license ? <p className="meta">License: {credit.license}</p> : null}
    </div>
  );
}

/** "With tips" shows tips and the why line; "Essentials" hides both. */
export type TipsMode = "tips" | "essentials";
export const TIPS_MODE_KEY = "textsous:tips-mode";

/** Remembered choice, default "tips". Storage can be missing or blocked. */
export function readTipsMode(): TipsMode {
  try {
    if (typeof window === "undefined") return "tips";
    return window.localStorage.getItem(TIPS_MODE_KEY) === "essentials" ? "essentials" : "tips";
  } catch {
    return "tips";
  }
}

function storeTipsMode(mode: TipsMode): void {
  try {
    window.localStorage.setItem(TIPS_MODE_KEY, mode);
  } catch {
    // Private windows and blocked storage: the choice lasts for this view only.
  }
}

/** Minutes the cook is busy: hands-on tasks never overlap (one cook). */
export function handsOnMinutes(tasks: Array<{ attention: string; minutes: number }>): number {
  return tasks.filter((t) => t.attention === "hands-on").reduce((sum, t) => sum + t.minutes, 0);
}

function BeforeYouStart({
  artifact,
  totalMinutes,
}: {
  artifact: CookAlongArtifact;
  totalMinutes: number | null;
}) {
  const timeline = artifact.timelineDefinition;
  const components = timeline.lanes.filter((lane) => lane.kind === "component");
  const colors = laneDisplayColors(timeline.lanes);
  const busy = handsOnMinutes(timeline.tasks);
  const equipment = artifact.recipe.equipment;
  return (
    <section className="card before-start" aria-label="Before you start">
      <h3>Before you start</h3>
      <p className="before-start-summary">
        {totalMinutes !== null ? `About ${totalMinutes} min to serve · ` : ""}
        {busy} min hands-on · One cook
      </p>
      {components.length > 0 ? (
        <>
          <h4>What you are cooking</h4>
          <ul className="component-list">
            {components.map((lane) => (
              <li key={lane.id}>
                <span className="lane-dot" style={{ backgroundColor: colors.get(lane.id) }} aria-hidden="true" />
                {lane.label}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4>Equipment</h4>
      {equipment.length > 0 ? (
        <ul className="equipment-list">
          {equipment.map((item, i) => (
            <li key={`${item}-${i}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="meta">No equipment listed.</p>
      )}
    </section>
  );
}

function TipsToggle({ mode, onChange }: { mode: TipsMode; onChange: (mode: TipsMode) => void }) {
  return (
    <div className="mode-toggle" role="group" aria-label="How much detail to show">
      <button
        type="button"
        className={mode === "essentials" ? "mode-option mode-active" : "mode-option"}
        aria-pressed={mode === "essentials"}
        onClick={() => onChange("essentials")}
      >
        Essentials
      </button>
      <button
        type="button"
        className={mode === "tips" ? "mode-option mode-active" : "mode-option"}
        aria-pressed={mode === "tips"}
        onClick={() => onChange("tips")}
      >
        With tips
      </button>
    </div>
  );
}

function TaskNotes({ task, mode }: { task: { tip?: string | null; why?: string | null }; mode: TipsMode }) {
  if (mode === "essentials") return null;
  return (
    <>
      {task.why ? <p className="why">Why: {task.why}</p> : null}
      {task.tip ? <p className="tip">Tip: {task.tip}</p> : null}
    </>
  );
}

function formatAmount(quantity: string, unit: string): string {
  return `${quantity} ${unit}`.trim();
}

const PHASE_NAMES: Record<TimelineTask["phase"], string> = {
  prep: "Prep",
  cook: "Cook",
  finish: "Finish",
};

/** Phase band: the phase's name above its cards, with a count. */
function PhaseBand({ phase, count, noun }: { phase: TimelineTask["phase"]; count: number; noun: string }) {
  return (
    <div className="phase-band">
      <span className="label">{PHASE_NAMES[phase]}</span>
      <span className="meta">
        {count} {count === 1 ? noun : `${noun}s`}
      </span>
    </div>
  );
}

/** The lanes a task belongs to, by name: component lanes first, the kitchen only when alone. */
export function taskLaneNames(task: Pick<TimelineTask, "laneIds">, lanes: readonly Lane[]): string {
  const byId = new Map(lanes.map((lane) => [lane.id, lane] as const));
  const named = task.laneIds.map((id) => byId.get(id)).filter((lane): lane is Lane => lane !== undefined);
  const components = named.filter((lane) => lane.kind === "component");
  return (components.length > 0 ? components : named).map((lane) => lane.label).join(" + ");
}

/** Small lane line at the top of a task card: the lane's dot and name. */
function TaskLane({ color, name }: { color: string; name: string }) {
  if (!name) return null;
  return (
    <p className="task-lane">
      <span className="lane-dot" style={{ backgroundColor: color }} aria-hidden="true" />
      {name}
    </p>
  );
}

/** Steps in order, with a phase band wherever the phase changes. Pure. */
export function phaseRuns<T extends { phase: TimelineTask["phase"] }>(
  tasks: readonly T[],
): Array<{ phase: TimelineTask["phase"]; items: Array<{ task: T; number: number }> }> {
  const runs: Array<{ phase: TimelineTask["phase"]; items: Array<{ task: T; number: number }> }> = [];
  tasks.forEach((task, i) => {
    const last = runs[runs.length - 1];
    if (!last || last.phase !== task.phase) runs.push({ phase: task.phase, items: [] });
    runs[runs.length - 1].items.push({ task, number: i + 1 });
  });
  return runs;
}

/**
 * Conversion notes: the server's (text cut, timings relabeled) and the
 * advisory review notes the artifact carries, so they show on cache hits,
 * saved links and after adjustments too.
 */
export function ConversionNotes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="notice" role="note" aria-label="Notes on this conversion">
      <p className="label">Notes on this conversion</p>
      <ul className="changes">
        {notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ArtifactViewer({
  artifact,
  onStartOver,
  notices = [],
  embedded = false,
  onClose,
  saveEnabled = saveToTextSousEnabled(),
}: {
  artifact: CookAlongArtifact;
  onStartOver: () => void;
  /** Warnings the convert call returned, shown above Before you start. */
  notices?: readonly string[];
  /** Inside the /embed overlay: save opens a new tab, Close replaces "Convert another recipe". */
  embedded?: boolean;
  onClose?: () => void;
  /** "Save to TextSous" shows unless the deploy turned it off (NEXT_PUBLIC_SAVE_TO_TEXTSOUS). */
  saveEnabled?: boolean;
}) {
  // Allergen floor on display too, so artifacts saved before it existed
  // (cache, ?src=) show inferred tags; Save sends the floored artifact.
  const floored = useMemo(() => applyArtifactAllergenFloor(artifact), [artifact]);
  const [current, setCurrent] = useState(floored);
  const [modified, setModified] = useState(false);
  const [prepDone, setPrepDone] = useState<Set<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<FriendlyError | null>(null);
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const [tipsMode, setTipsMode] = useState<TipsMode>(readTipsMode);

  function chooseTipsMode(mode: TipsMode) {
    setTipsMode(mode);
    storeTipsMode(mode);
  }

  const totalMinutes = useMemo(() => {
    try {
      return schedule(current.timelineDefinition).totalMinutes;
    } catch {
      return null;
    }
  }, [current]);

  const recipe = current.recipe;
  const timeline = current.timelineDefinition;
  const prepTasks = timeline.tasks.filter((t) => t.phase === "prep");
  const traces = rollUpTraces(recipe.ingredients);
  const mayContain = traces.length > 0 ? ` May contain: ${traces.join(", ")}.` : "";
  const cookTasks = timeline.tasks.filter((t) => t.phase !== "prep");
  const stepRuns = phaseRuns(cookTasks);
  // Lanes are colored by position, not by the color the artifact stored.
  const colors = laneDisplayColors(timeline.lanes);

  function togglePrep(id: string) {
    setPrepDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAdjusted(next: CookAlongArtifact) {
    setCurrent(next);
    setModified(true);
  }

  function handleReset() {
    setCurrent(floored);
    setModified(false);
  }

  async function saveToTextSous() {
    if (saveBusy) return;
    // Embedded: open the tab now, inside the click, so popup blockers allow it.
    const tab = embedded ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    setSaveBusy(true);
    setSaveError(null);
    const res = await apiFetch("/api/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: current }),
    });
    const data = res.data as { url?: string; error?: string } | null;
    if (!res.ok || !data || !data.url) {
      tab?.close();
      setSaveError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
      setSaveBusy(false);
      return;
    }
    setSaveBusy(false);
    if (embedded) {
      setImportUrl(buildImportUrl(data.url));
      if (tab) tab.location.href = buildImportUrl(data.url);
      return;
    }
    window.location.href = buildImportUrl(data.url);
  }

  return (
    <article aria-label="Cook Along recipe">
      <div className="recipe-head">
        <p className="label">Your cook along</p>
        <h2 className="recipe-title">{recipe.title}</h2>
        <p className="meta">
          Serves {recipe.servings} · {recipe.ingredients.length} ingredients
          {totalMinutes !== null ? ` · About ${totalMinutes} minutes` : ""}
          {recipe.methodLabel ? ` · Method: ${recipe.methodLabel}` : ""}
        </p>
      </div>

      <Credit artifact={current} />

      {recipe.allergens.length > 0 ? (
        <div className="allergens" aria-label="Allergens">
          <h3>Allergens</h3>
          <p className="notice" role="note">
            <strong>Contains:</strong> {recipe.allergens.join(", ")}.{mayContain} This list can
            miss things. Check every label.
          </p>
        </div>
      ) : (
        <p className="notice" role="note">
          Allergen information is unknown.{mayContain} This list can miss things. Check every
          label.
        </p>
      )}

      {recipe.methodNotice ? (
        <p className="notice" role="note">
          {recipe.methodNotice}
        </p>
      ) : null}

      <AdjustPanel
        artifact={current}
        modified={modified}
        onAdjusted={(next: CookAlongArtifact) => handleAdjusted(next)}
        onReset={handleReset}
      />

      <ConversionNotes notes={mergeNotes(notices, reviewNoteTexts(current))} />

      <BeforeYouStart artifact={current} totalMinutes={totalMinutes} />

      <section className="card">
        <h3>Ingredients</h3>
        <ul className="ingredients">
          {recipe.ingredients.map((ing) => (
            <li key={ing.id}>
              <strong>{formatAmount(ing.cookQuantity ?? ing.quantity, ing.unit)}</strong> {ing.name}
              {ing.buyQuantity ? <span className="meta"> · buy {ing.buyQuantity}</span> : null}
              {ing.note ? <span> — {ing.note}</span> : null}
              {ing.allergens.length > 0 ? (
                <span className="meta"> · contains {ing.allergens.join(", ")}</span>
              ) : null}
              {ing.allergenTraces.length > 0 ? (
                <span className="meta"> · traces of {ing.allergenTraces.join(", ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <TipsToggle mode={tipsMode} onChange={chooseTipsMode} />

      <h3>Mise en Place</h3>
      {prepTasks.length > 0 ? (
        <>
          <PhaseBand phase="prep" count={prepTasks.length} noun="task" />
          <ul className="prep-list">
            {prepTasks.map((task) => (
              <li
                key={task.id}
                className={task.attention === "unattended" ? "task-card unattended" : "task-card"}
                style={{ borderLeftColor: taskLaneColor(colors, task.laneIds) }}
              >
                <TaskLane color={taskLaneColor(colors, task.laneIds)} name={taskLaneNames(task, timeline.lanes)} />
                <label>
                  <input
                    type="checkbox"
                    checked={prepDone.has(task.id)}
                    onChange={() => togglePrep(task.id)}
                  />
                  <span className={prepDone.has(task.id) ? "prep-done" : ""}>
                    <strong>{task.label}</strong> <span className="meta">· {task.minutes} min</span>
                    <br />
                    {task.description}
                    <TaskNotes task={task} mode={tipsMode} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="meta">No prep tasks — everything happens at the stove.</p>
      )}

      <h3>Timeline</h3>
      <TimelineView timeline={timeline} />

      <h3>Steps</h3>
      {stepRuns.map((run, r) => (
        <Fragment key={`${run.phase}-${r}`}>
          <PhaseBand phase={run.phase} count={run.items.length} noun="step" />
          {run.items.map(({ task, number }) => {
            const color = taskLaneColor(colors, task.laneIds);
            return (
              <div
                key={task.id}
                className={task.attention === "unattended" ? "task-card step unattended" : "task-card step"}
                style={{ borderLeftColor: color }}
              >
                <TaskLane color={color} name={taskLaneNames(task, timeline.lanes)} />
                <h4>
                  {number}. {task.cardTitle.action} — {task.cardTitle.subject}
                  {task.cardTitle.context ? ` (${task.cardTitle.context})` : ""}
                </h4>
                <p>{task.description}</p>
                <p className="cue">Done when: {task.completionCue}</p>
                <p className="meta">
                  {task.minutes} min
                  {task.range ? ` (${task.range.low}–${task.range.high})` : ""} · {task.attention} ·{" "}
                  {task.phase} · {task.timingBasis === "source" ? "timed by the recipe" : "estimated time"}
                  {task.equipmentEvent === "oven-on"
                    ? " · turn the oven on"
                    : task.equipmentEvent === "oven-off"
                      ? " · turn the oven off"
                      : ""}
                </p>
                {task.checkpoints.length > 0 ? (
                  <ul className="changes">
                    {task.checkpoints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : null}
                <TaskNotes task={task} mode={tipsMode} />
                <Timer minutes={task.minutes} label={task.label} />
              </div>
            );
          })}
        </Fragment>
      ))}

      {current.changes.length > 0 ? (
        <details>
          <summary>What changed</summary>
          <ul className="changes">
            {current.changes.map((change, i) => (
              <li key={i}>
                <span className="change-kind">{CHANGE_LABELS[change.kind]}:</span> {change.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {saveError ? <ErrorBox error={saveError} /> : null}
      <div className="btn-row save-row">
        {saveEnabled ? (
          <button type="button" className="btn btn-primary" onClick={saveToTextSous} disabled={saveBusy}>
            {saveBusy ? "Saving…" : "Save to TextSous"}
          </button>
        ) : null}
        {embedded && onClose ? (
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        ) : (
          <button type="button" className="btn" onClick={onStartOver}>
            Convert another recipe
          </button>
        )}
      </div>
      {importUrl ? (
        <p className="meta">
          TextSous opened in a new tab.{" "}
          <a href={importUrl} target="_blank" rel="noopener">
            Continue to TextSous
          </a>{" "}
          if it didn&apos;t.
        </p>
      ) : null}
      {saveEnabled ? (
        <p className="meta">Saving keeps the recipe for 24 hours so TextSous can import it.</p>
      ) : null}
    </article>
  );
}
