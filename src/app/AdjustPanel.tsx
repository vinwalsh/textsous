"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import type { CookAlongArtifact } from "../lib/schema/artifact";
import { DIETARY_TARGETS, MAX_CUISINE_CHARS } from "../lib/schema/variant";
import { reviewNoteTexts } from "../lib/review-notes";
import { MAX_SERVINGS } from "../lib/scaling/servings";
import type { ScaleFlag } from "../lib/stages/scaling";
import ErrorBox from "./ErrorBox";
import ProgressNote from "./ProgressNote";
import {
  apiFetch,
  convertNotices,
  friendlyError,
  submitButtonClass,
  type ApiResult,
  type FriendlyError,
} from "./request";
import { withScreenOn } from "./wake-lock";

interface AdjustOk {
  artifact: CookAlongArtifact;
  scaleFlags: ScaleFlag[];
  warnings?: unknown;
}

/**
 * This adjustment's own notes for the What changed summary ("Check these
 * amounts; they were not rescaled: ..."): the adjust response's warnings
 * without the conversion's review notes, which Notes on this conversion
 * already shows. Pure.
 */
export function adjustNotices(warnings: unknown, artifact: Pick<CookAlongArtifact, "reviewNotes">): string[] {
  const review = new Set(reviewNoteTexts(artifact));
  return convertNotices(warnings).filter((note) => !review.has(note.trim()));
}

/** One scale flag as a sentence with readable positions, never an id. Pure. */
export function scaleFlagText(flag: ScaleFlag, steps: ReadonlyArray<{ id: string }>): string {
  if (flag.card) return `“${flag.card}” card: “${flag.token}” was left as printed — check it yourself.`;
  const index = steps.findIndex((s) => s.id === flag.stepId);
  const where = index >= 0 ? `Step ${index + 1}` : "A step";
  return `${where}: “${flag.token}” was left as printed — check it yourself.`;
}

/**
 * Friendly copy for a failed adjustment. The daily-cap button keeps the
 * recipe's link (/assistants?url=...) when the artifact came from a URL (C7).
 * Pure.
 */
export function adjustFailure(
  res: { status: number | null; timeout: boolean },
  data: { error?: string; reason?: string } | null,
  artifact: Pick<CookAlongArtifact, "recipe">,
): FriendlyError {
  if (!res.timeout && (res.status === 503 || res.status === 504)) {
    // The server's time limit. The conversion copy would say to paste the
    // ingredients, and this panel has nowhere to paste.
    return {
      title: "That took too long",
      detail: "Applying these changes took too long. Try again in a minute, or apply one change at a time.",
    };
  }
  const credit = artifact.recipe.credit;
  const recipeUrl = credit.kind === "url" ? (credit.url ?? undefined) : undefined;
  return friendlyError(res.status, data?.error ?? "", {
    timeout: res.timeout,
    reason: data?.reason,
    ...(recipeUrl ? { recipeUrl } : {}),
  });
}

function labelTarget(target: string): string {
  return target.charAt(0).toUpperCase() + target.slice(1);
}

/** What the cook chose in the panel. Empty dietary and cuisine mean no change. */
export interface AdjustChoices {
  servings: number;
  dietary: string;
  cuisine: string;
  sousVoice: boolean;
}

/** Whether the choices change a recipe that serves `baseServings`. Pure. */
export function hasAdjustment(choices: AdjustChoices, baseServings: number): boolean {
  return (
    choices.servings !== baseServings ||
    choices.dietary !== "" ||
    choices.cuisine.trim() !== "" ||
    choices.sousVoice
  );
}

/** The POST /api/adjust body for these choices. Pure. */
export function adjustRequestBody(artifact: CookAlongArtifact, choices: AdjustChoices): Record<string, unknown> {
  const body: Record<string, unknown> = { artifact };
  if (choices.servings !== artifact.recipe.servings) body.servings = choices.servings;
  if (choices.dietary !== "") body.dietary = choices.dietary;
  if (choices.cuisine.trim() !== "") body.cuisine = choices.cuisine.trim();
  if (choices.sousVoice) body.voice = "sous";
  return body;
}

/** "serves 2 → 4 · Gluten-free · Italian style · SOUS voice". Pure. */
export function adjustSummary(baseServings: number, choices: AdjustChoices): string {
  const parts: string[] = [];
  if (choices.servings !== baseServings) parts.push(`serves ${baseServings} → ${choices.servings}`);
  if (choices.dietary !== "") parts.push(labelTarget(choices.dietary));
  if (choices.cuisine.trim() !== "") parts.push(`${choices.cuisine.trim()} style`);
  if (choices.sousVoice) parts.push("SOUS voice");
  return parts.join(" · ");
}

/** POST /api/adjust for these choices, keeping the screen on. */
export function requestAdjustment(artifact: CookAlongArtifact, choices: AdjustChoices): Promise<ApiResult> {
  return withScreenOn(() =>
    apiFetch("/api/adjust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(adjustRequestBody(artifact, choices)),
    }),
  );
}

/** Queued mode: the cook along is still being written, so choices wait for it. */
export interface PendingAdjust {
  /** Servings the recipe is written for. */
  servings: number;
  queued: AdjustChoices | null;
  onQueue: (choices: AdjustChoices | null) => void;
}

export default function AdjustPanel({
  artifact,
  modified = false,
  onAdjusted,
  onReset,
  pending,
  autoApply,
}: {
  /** The finished cook along; null while it is being written (queued mode, see `pending`). */
  artifact: CookAlongArtifact | null;
  modified?: boolean;
  onAdjusted?: (next: CookAlongArtifact, summary: string, flags: ScaleFlag[]) => void;
  onReset?: () => void;
  pending?: PendingAdjust;
  /** Choices queued before the cook along was ready: applied once, as soon as this shows. */
  autoApply?: AdjustChoices | null;
}) {
  const base = artifact ? artifact.recipe.servings : (pending?.servings ?? 1);
  const preset = artifact ? autoApply : pending?.queued;
  const autoRun = artifact !== null && autoApply != null && hasAdjustment(autoApply, base);
  const [servings, setServings] = useState(preset?.servings ?? base);
  const [dietary, setDietary] = useState(preset?.dietary ?? "");
  const [cuisine, setCuisine] = useState(preset?.cuisine ?? "");
  const [sousVoice, setSousVoice] = useState(preset?.sousVoice ?? false);
  const [applying, setApplying] = useState(autoRun);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [summary, setSummary] = useState("");
  const [flags, setFlags] = useState<ScaleFlag[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const autoRan = useRef(false);

  const hasChange = hasAdjustment({ servings, dietary, cuisine, sousVoice }, base);
  const queued = artifact ? null : (pending?.queued ?? null);

  async function apply(choices: AdjustChoices) {
    if (!artifact) return;
    setApplying(true);
    setError(null);
    const res = await requestAdjustment(artifact, choices);
    const data = res.data as (AdjustOk & { error?: string; reason?: string }) | null;
    if (!res.ok || !data || !data.artifact) {
      setError(adjustFailure(res, data, artifact));
      setApplying(false);
      return;
    }
    const nextSummary = adjustSummary(artifact.recipe.servings, choices);
    setSummary(nextSummary);
    setFlags(data.scaleFlags);
    setNotes(adjustNotices(data.warnings, data.artifact));
    setServings(data.artifact.recipe.servings);
    setDietary("");
    setCuisine("");
    setSousVoice(false);
    setApplying(false);
    onAdjusted?.(data.artifact, nextSummary, data.scaleFlags);
  }

  // Choices queued while the cook along was being written: apply them once.
  const applyQueued = useEffectEvent(() => {
    if (autoRan.current || !autoApply) return;
    autoRan.current = true;
    void apply(autoApply);
  });
  useEffect(() => {
    if (!autoRun) return;
    const id = setTimeout(() => applyQueued(), 0);
    return () => clearTimeout(id);
  }, [autoRun]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChange || applying) return;
    const choices: AdjustChoices = { servings, dietary, cuisine, sousVoice };
    if (!artifact) {
      pending?.onQueue(choices);
      return;
    }
    await apply(choices);
  }

  function cancelQueued() {
    pending?.onQueue(null);
    setServings(base);
    setDietary("");
    setCuisine("");
    setSousVoice(false);
  }

  return (
    <section aria-label="Adjust this recipe" className="card adjust-panel">
      <h2 className="card-title">Adjust this recipe</h2>
      {artifact ? null : (
        <p className="meta adjust-pending">
          Your cook along is still being written. Choose changes now and they apply as soon as it&apos;s
          ready.
        </p>
      )}
      <form onSubmit={onSubmit}>
        <div className="adjust-grid">
          <label className="field">
            <span>Servings (now {base})</span>
            <span className="stepper">
              <button
                type="button"
                className="btn"
                aria-label="One fewer serving"
                disabled={applying || servings <= 1}
                onClick={() => setServings((s) => Math.max(1, s - 1))}
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={MAX_SERVINGS}
                step={1}
                value={servings}
                disabled={applying}
                onChange={(e) => setServings(Number(e.target.value))}
                aria-label="Servings"
              />
              <button
                type="button"
                className="btn"
                aria-label="One more serving"
                disabled={applying || servings >= MAX_SERVINGS}
                onClick={() => setServings((s) => Math.min(MAX_SERVINGS, s + 1))}
              >
                +
              </button>
            </span>
          </label>
          <label className="field">
            <span>Dietary</span>
            <select
              value={dietary}
              disabled={applying}
              onChange={(e) => setDietary(e.target.value)}
            >
              <option value="">No change</option>
              {DIETARY_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {labelTarget(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field adjust-wide">
            <span>Cuisine style</span>
            <input
              type="text"
              placeholder="e.g. Italian"
              maxLength={MAX_CUISINE_CHARS}
              value={cuisine}
              disabled={applying}
              onChange={(e) => setCuisine(e.target.value)}
            />
          </label>
          <label className="check-row adjust-wide">
            <input
              type="checkbox"
              checked={sousVoice}
              disabled={applying}
              onChange={(e) => setSousVoice(e.target.checked)}
            />
            Rewrite the steps in SOUS voice
          </label>
        </div>
        {error ? <ErrorBox error={error} /> : null}
        {applying ? <ProgressNote kind="adjust" /> : null}
        <div className="btn-row">
          <button
            type="submit"
            className={submitButtonClass(error)}
            disabled={!hasChange || applying}
          >
            {applying ? "Adjusting…" : artifact ? "Apply adjustments" : "Apply when ready"}
          </button>
          {modified ? (
            <button type="button" className="btn" onClick={onReset} disabled={applying}>
              Back to the original
            </button>
          ) : null}
          {queued ? (
            <button type="button" className="btn" onClick={cancelQueued}>
              Cancel changes
            </button>
          ) : null}
        </div>
      </form>
      {queued ? (
        <div className="adjust-summary" role="status">
          <p>
            <strong>Will apply when ready:</strong> {adjustSummary(base, queued)}
          </p>
          <p className="meta">You can change these until your cook along is ready.</p>
        </div>
      ) : null}
      {summary ? (
        <div className="adjust-summary">
          <p>
            <strong>What changed:</strong> {summary}
          </p>
          {notes.length + flags.length > 0 ? (
            <ul className="changes">
              {notes.map((note, i) => (
                <li key={`note-${i}`}>{note}</li>
              ))}
              {flags.map((f, i) => (
                <li key={`${f.stepId}-${i}`}>{scaleFlagText(f, artifact?.recipe.steps ?? [])}</li>
              ))}
            </ul>
          ) : null}
          <p className="meta">Full details are in the What changed list below.</p>
        </div>
      ) : null}
    </section>
  );
}
