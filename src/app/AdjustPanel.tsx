"use client";

import { useState, type FormEvent } from "react";
import type { CookAlongArtifact } from "../lib/schema/artifact";
import { DIETARY_TARGETS, MAX_CUISINE_CHARS } from "../lib/schema/variant";
import type { ScaleFlag } from "../lib/stages/scaling";
import ErrorBox from "./ErrorBox";
import ProgressNote from "./ProgressNote";
import { apiFetch, friendlyError, type FriendlyError } from "./request";
import { withScreenOn } from "./wake-lock";

interface AdjustOk {
  artifact: CookAlongArtifact;
  scaleFlags: ScaleFlag[];
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

export default function AdjustPanel({
  artifact,
  modified,
  onAdjusted,
  onReset,
}: {
  artifact: CookAlongArtifact;
  modified: boolean;
  onAdjusted: (next: CookAlongArtifact, summary: string, flags: ScaleFlag[]) => void;
  onReset: () => void;
}) {
  const [servings, setServings] = useState(artifact.recipe.servings);
  const [dietary, setDietary] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [sousVoice, setSousVoice] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [summary, setSummary] = useState("");
  const [flags, setFlags] = useState<ScaleFlag[]>([]);

  const servingsChanged = servings !== artifact.recipe.servings;
  const hasChange = servingsChanged || dietary !== "" || cuisine.trim() !== "" || sousVoice;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChange || applying) return;
    setApplying(true);
    setError(null);
    const body: Record<string, unknown> = { artifact };
    if (servingsChanged) body.servings = servings;
    if (dietary !== "") body.dietary = dietary;
    if (cuisine.trim() !== "") body.cuisine = cuisine.trim();
    if (sousVoice) body.voice = "sous";
    const res = await withScreenOn(() =>
      apiFetch("/api/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const data = res.data as (AdjustOk & { error?: string; reason?: string }) | null;
    if (!res.ok || !data || !data.artifact) {
      setError(adjustFailure(res, data, artifact));
      setApplying(false);
      return;
    }
    const parts: string[] = [];
    if (servingsChanged) parts.push(`serves ${artifact.recipe.servings} → ${servings}`);
    if (dietary !== "") parts.push(labelTarget(dietary));
    if (cuisine.trim() !== "") parts.push(`${cuisine.trim()} style`);
    if (sousVoice) parts.push("SOUS voice");
    const nextSummary = parts.join(" · ");
    setSummary(nextSummary);
    setFlags(data.scaleFlags);
    setServings(data.artifact.recipe.servings);
    setDietary("");
    setCuisine("");
    setSousVoice(false);
    setApplying(false);
    onAdjusted(data.artifact, nextSummary, data.scaleFlags);
  }

  return (
    <section aria-label="Adjust this recipe" className="card adjust-panel">
      <h2 className="card-title">Adjust this recipe</h2>
      <form onSubmit={onSubmit}>
        <div className="adjust-grid">
          <label className="field">
            <span>Servings (now {artifact.recipe.servings})</span>
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
                max={12}
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
                disabled={applying || servings >= 12}
                onClick={() => setServings((s) => Math.min(12, s + 1))}
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
              placeholder="Can you make this dish more Italian-style?"
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
          <button type="submit" className="btn btn-primary" disabled={!hasChange || applying}>
            {applying ? "Adjusting…" : "Apply adjustments"}
          </button>
          {modified ? (
            <button type="button" className="btn" onClick={onReset} disabled={applying}>
              Back to the original
            </button>
          ) : null}
        </div>
      </form>
      {summary ? (
        <div className="adjust-summary">
          <p>
            <strong>What changed:</strong> {summary}
          </p>
          {flags.length > 0 ? (
            <ul className="changes">
              {flags.map((f, i) => (
                <li key={`${f.stepId}-${i}`}>{scaleFlagText(f, artifact.recipe.steps)}</li>
              ))}
            </ul>
          ) : null}
          <p className="meta">Full details are in the What changed list below.</p>
        </div>
      ) : null}
    </section>
  );
}
