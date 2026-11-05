"use client";

import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { RecipeOverview } from "../lib/convert-events";
import type { ArtifactChange, ArtifactCredit, CookAlongArtifact } from "../lib/schema/artifact";
import type { Lane, TimelineDefinition, TimelineTask } from "../lib/schema/timeline";
import { buildImportUrl, saveToTextSousEnabled } from "../lib/handoff";
import { applyArtifactAllergenFloor, rollUpTraces } from "../lib/allergens";
import { laneDisplayColors, taskLaneColor } from "../lib/lane-palette";
import { mergeNotes, reviewNoteTexts } from "../lib/review-notes";
import { formatQuantityWithUnit } from "../lib/scaling/units";
import { schedule } from "../lib/scheduler/schedule";
import ErrorBox from "./ErrorBox";
import { apiFetch, friendlyError, type FriendlyError } from "./request";
import AdjustPanel, { adjustingLine, hasAdjustment, type AdjustChoices } from "./AdjustPanel";
import { adjustedSections, type SectionKey } from "./section-states";
import { PreAdjustMark } from "./SectionStatus";
import { FinishLine } from "./CookingLine";
import CookAlongView from "./CookAlongView";
import { cookingPilotInput } from "../lib/cooking-pilot/from-artifact";
import TimelineView from "./TimelineView";
import Timer from "./Timer";

const CHANGE_LABELS: Record<ArtifactChange["kind"], string> = {
  "merged-steps": "Steps merged",
  estimate: "Estimated timing",
  scale: "Scaled",
  swap: "Swapped",
  technique: "Technique",
};

type Ingredient = CookAlongArtifact["recipe"]["ingredients"][number];

/** Source credit: site, author and "View original" for URLs; book, author and page for photos. */
export function Credit({ credit }: { credit: ArtifactCredit }) {
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

/**
 * Where "Cook on Meta glasses" goes when the cook along can't be stored:
 * the recipe page for URL recipes (converted again, cache-first), else the
 * glasses picker. Pure.
 */
export function glassesFallbackHref(credit: Pick<ArtifactCredit, "kind" | "url">): string {
  return credit.kind === "url" && credit.url ? `/glasses?url=${encodeURIComponent(credit.url)}` : "/glasses";
}

/** The heads-up cook along for a stored (signed) artifact link. Pure. */
export function glassesHref(signedArtifactUrl: string): string {
  return `/glasses?src=${encodeURIComponent(signedArtifactUrl)}`;
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

export function storeTipsMode(mode: TipsMode): void {
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

/**
 * A quick read of the recipe: what you'll do, and each component with how it
 * is made. `mark` shows beside the heading (the progressive view's "Ready").
 */
export function OverviewCard({ overview, mark }: { overview: RecipeOverview; mark?: ReactNode }) {
  return (
    <section className="card overview" aria-label="What you'll do">
      <h3>
        What you&apos;ll do{mark}
      </h3>
      <p>{overview.summary}</p>
      {overview.components.length > 0 ? (
        <>
          <h4>Components</h4>
          <ul className="overview-parts">
            {overview.components.map((part, i) => (
              <li key={`${part.name}-${i}`}>
                <strong>{part.name}</strong>
                <span>{part.how}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** `mark` shows beside the heading, `status` under it (Ready, Before your changes). */
export function IngredientsCard({
  ingredients,
  mark,
  status,
}: {
  ingredients: readonly Ingredient[];
  mark?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section className="card">
      <h3>Ingredients{mark}</h3>
      {status}
      <ul className="ingredients">
        {ingredients.map((ing) => (
          <li key={ing.id}>
            <strong>{formatQuantityWithUnit(ing.cookQuantity ?? ing.quantity, ing.unit)}</strong> {ing.name}
            {ing.buyQuantity ? (
              <span className="meta"> · buy {formatQuantityWithUnit(ing.buyQuantity, ing.unit)}</span>
            ) : null}
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
  );
}

/**
 * Time to serve, hands-on minutes, the components and the equipment. Before
 * the steps are laid out (timeline null) it shows the equipment only.
 * `mark` shows beside the heading, `status` under it.
 */
export function BeforeYouStart({
  equipment,
  timeline,
  totalMinutes,
  mark,
  status,
}: {
  equipment: readonly string[];
  timeline: TimelineDefinition | null;
  totalMinutes: number | null;
  mark?: ReactNode;
  status?: ReactNode;
}) {
  const components = timeline ? timeline.lanes.filter((lane) => lane.kind === "component") : [];
  const colors = laneDisplayColors(timeline?.lanes ?? []);
  return (
    <section className="card before-start" aria-label="Before you start">
      <h3>Before you start{mark}</h3>
      {status}
      {timeline ? (
        <p className="before-start-summary">
          {totalMinutes !== null ? `About ${totalMinutes} min to serve · ` : ""}
          {handsOnMinutes(timeline.tasks)} min hands-on · One cook
        </p>
      ) : null}
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

export function TipsToggle({ mode, onChange }: { mode: TipsMode; onChange: (mode: TipsMode) => void }) {
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

/** Whether any task carries a tip or a why line (the "With tips" choice is worth offering). */
export function hasTaskNotes(tasks: ReadonlyArray<{ tip?: string | null; why?: string | null }>): boolean {
  return tasks.some((task) => Boolean(task.tip) || Boolean(task.why));
}

/**
 * "Prep (Mise en Place style)": every prep task before the first cook step.
 * With `onToggle` each card has a checkbox. `status` shows under the heading.
 */
export function PrepSection({
  timeline,
  tipsMode,
  done,
  onToggle,
  status,
}: {
  timeline: TimelineDefinition;
  tipsMode: TipsMode;
  done?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  status?: ReactNode;
}) {
  const prepTasks = timeline.tasks.filter((t) => t.phase === "prep");
  // Lanes are colored by position, not by the color the artifact stored.
  const colors = laneDisplayColors(timeline.lanes);
  return (
    <>
      <h3>Prep (Mise en Place style)</h3>
      {status}
      {prepTasks.length > 0 ? (
        <>
          <PhaseBand phase="prep" count={prepTasks.length} noun="task" />
          <ul className="prep-list">
            {prepTasks.map((task) => {
              const color = taskLaneColor(colors, task.laneIds);
              const text = (
                <span className={done?.has(task.id) ? "prep-done" : ""}>
                  <strong>{task.label}</strong> <span className="meta">· {task.minutes} min</span>
                  <br />
                  {task.description}
                  <TaskNotes task={task} mode={tipsMode} />
                </span>
              );
              return (
                <li
                  key={task.id}
                  className={task.attention === "unattended" ? "task-card unattended" : "task-card"}
                  style={{ borderLeftColor: color }}
                >
                  <TaskLane color={color} name={taskLaneNames(task, timeline.lanes)} />
                  {onToggle ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={done?.has(task.id) ?? false}
                        onChange={() => onToggle(task.id)}
                      />
                      {text}
                    </label>
                  ) : (
                    text
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="meta">No prep tasks — everything happens at the stove.</p>
      )}
    </>
  );
}

/** The cook and finish steps as numbered cards. `status` shows under the heading. */
export function StepsSection({
  timeline,
  tipsMode,
  timers = true,
  status,
}: {
  timeline: TimelineDefinition;
  tipsMode: TipsMode;
  timers?: boolean;
  status?: ReactNode;
}) {
  const stepRuns = phaseRuns(timeline.tasks.filter((t) => t.phase !== "prep"));
  const colors = laneDisplayColors(timeline.lanes);
  return (
    <>
      <h3>Steps</h3>
      {status}
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
                {timers ? <Timer minutes={task.minutes} label={task.label} /> : null}
              </div>
            );
          })}
        </Fragment>
      ))}
    </>
  );
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

/**
 * The finished cook along, in the order the progressive view fills in:
 * title, credit and allergens, the overview, adjustments, ingredients,
 * before you start, prep, steps, notes, then the timeline graphic last.
 */
export default function ArtifactViewer({
  artifact,
  onStartOver,
  notices = [],
  embedded = false,
  onClose,
  saveEnabled = saveToTextSousEnabled(),
  overview = null,
  queuedAdjustments = null,
  onQueuedApplied,
  built = false,
  cookAlongView = true,
  adjustNote = null,
}: {
  artifact: CookAlongArtifact;
  onStartOver: () => void;
  /** Warnings the convert call returned, shown with Notes on this conversion. */
  notices?: readonly string[];
  /** Inside the /embed overlay: save opens a new tab, Close replaces "Convert another recipe". */
  embedded?: boolean;
  onClose?: () => void;
  /** "Save to TextSous" shows unless the deploy turned it off (NEXT_PUBLIC_SAVE_TO_TEXTSOUS). */
  saveEnabled?: boolean;
  /** The quick read from a streamed conversion, when there was one. */
  overview?: RecipeOverview | null;
  /** Adjustments chosen while the cook along was being written: applied as it opens. */
  queuedAdjustments?: AdjustChoices | null;
  /** Called once the queued adjustments were applied, or failed to apply. */
  onQueuedApplied?: () => void;
  /** Just written on this page: the top line says Ready for a moment. */
  built?: boolean;
  /** false keeps the open sections in place of the Cook Along view (their tests). */
  cookAlongView?: boolean;
  /** Set, the adjust panel's Apply button is off with this line (a replay on /simulate). */
  adjustNote?: string | null;
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
  // The adjustment being applied (queued ones start at once): the sections
  // it rewrites say "Before your changes" until the adjusted cook along shows.
  const [adjusting, setAdjusting] = useState<AdjustChoices | null>(() =>
    queuedAdjustments && hasAdjustment(queuedAdjustments, floored.recipe.servings) ? queuedAdjustments : null,
  );

  const [glassesBusy, setGlassesBusy] = useState(false);
  const [glassesError, setGlassesError] = useState<FriendlyError | null>(null);

  // Back from the glasses view can restore this page from the back/forward
  // cache: the link reads Cook on Meta glasses again.
  useEffect(() => {
    function onShow(event: PageTransitionEvent) {
      if (event.persisted) setGlassesBusy(false);
    }
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

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
  const rewriting = new Set<SectionKey>(adjustedSections(adjusting, recipe.servings));
  const adjustingText = adjusting ? adjustingLine(recipe.servings, adjusting) : null;
  const before = (key: SectionKey) => (rewriting.has(key) ? <PreAdjustMark adjusting={adjustingText} /> : null);
  // Cook Along body: the ported TextSous Cook Along view when the artifact
  // adapts and schedules for it; else the open sections below (fallback).
  const pilotInput = useMemo(() => (cookAlongView ? cookingPilotInput(current) : null), [current, cookAlongView]);
  // One time to serve on the page: the Cook Along view's own header shows
  // it (and follows Adjust Cooking Times), so the facts line carries the
  // total only above the fallback sections.
  const factsMinutes = pilotInput ? null : totalMinutes;
  // Save sends the cook along as shown, so it waits while an adjustment applies.
  const saveWaits = adjusting !== null;
  const traces = rollUpTraces(recipe.ingredients);
  const mayContain = traces.length > 0 ? ` May contain: ${traces.join(", ")}.` : "";

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
    if (saveBusy || saveWaits) return;
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

  // The glasses get exactly this cook along (adjustments included) through
  // a 24-hour signed link; a URL recipe falls back to its page.
  async function cookOnGlasses(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (glassesBusy) return;
    setGlassesBusy(true);
    setGlassesError(null);
    const res = await apiFetch("/api/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: current }),
    });
    const data = res.data as { url?: string; error?: string } | null;
    // Not busy once we leave: browser Back may show this page again as it was.
    setGlassesBusy(false);
    if (res.ok && data?.url) {
      window.location.href = glassesHref(data.url);
      return;
    }
    if (recipe.credit.kind === "url" && recipe.credit.url) {
      window.location.href = glassesFallbackHref(recipe.credit);
      return;
    }
    setGlassesError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
  }

  return (
    <article aria-label="Cook Along recipe">
      <FinishLine adjusting={adjusting !== null} built={built} />
      <div className="recipe-head">
        <p className="label">Your Cook Along</p>
        <h2 className="recipe-title">{recipe.title}</h2>
        <p className="meta">
          Serves {recipe.servings} · {recipe.ingredients.length} ingredients
          {factsMinutes !== null ? ` · About ${factsMinutes} minutes` : ""}
          {recipe.methodLabel ? ` · Method: ${recipe.methodLabel}` : ""}
        </p>
        {before("facts")}
      </div>

      <Credit credit={recipe.credit} />

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

      {overview ? <OverviewCard overview={overview} /> : null}

      <AdjustPanel
        artifact={current}
        modified={modified}
        onAdjusted={(next: CookAlongArtifact) => handleAdjusted(next)}
        onReset={handleReset}
        autoApply={queuedAdjustments}
        onAutoApplied={onQueuedApplied}
        onApplyingChange={setAdjusting}
        disabledNote={adjustNote}
      />

      {pilotInput ? null : (<>
      <IngredientsCard ingredients={recipe.ingredients} status={before("ingredients")} />

      <BeforeYouStart equipment={recipe.equipment} timeline={timeline} totalMinutes={totalMinutes} />

      <TipsToggle mode={tipsMode} onChange={chooseTipsMode} />

      <PrepSection
        timeline={timeline}
        tipsMode={tipsMode}
        done={prepDone}
        onToggle={togglePrep}
        status={before("prep")}
      />

      <StepsSection timeline={timeline} tipsMode={tipsMode} status={before("steps")} />
      </>)}

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

      <ConversionNotes notes={mergeNotes(notices, reviewNoteTexts(current))} />

      {pilotInput ? (
        <CookAlongView input={pilotInput} adjusting={rewriting.has("timeline") ? adjustingText : null} />
      ) : (<>
      <h3>Timeline</h3>
      {before("timeline")}
      <TimelineView timeline={timeline} />
      </>)}

      {saveError ? <ErrorBox error={saveError} /> : null}
      <div className="btn-row save-row">
        {saveEnabled ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={saveToTextSous}
            disabled={saveBusy || saveWaits}
          >
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
      {saveEnabled && saveWaits ? <p className="meta">Saving waits until your changes apply.</p> : null}
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
      {!embedded ? (
        <p className="meta glasses-link">
          <a href={glassesFallbackHref(recipe.credit)} onClick={(event) => void cookOnGlasses(event)}>
            {glassesBusy ? "Opening the glasses view…" : "Cook on Meta glasses"}
          </a>
        </p>
      ) : null}
      {glassesError ? <ErrorBox error={glassesError} /> : null}
    </article>
  );
}
