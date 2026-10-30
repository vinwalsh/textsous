"use client";

import { useState, type FormEvent } from "react";
import type { CookAlongArtifact } from "../lib/schema/artifact";
import { DIETARY_TARGETS } from "../lib/schema/variant";
import type { ScaleFlag } from "../lib/stages/scaling";
import ErrorBox from "./ErrorBox";
import { apiFetch, friendlyError, type FriendlyError } from "./request";

interface AdjustOk {
  artifact: CookAlongArtifact;
  scaleFlags: ScaleFlag[];
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
    const res = await apiFetch("/api/adjust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = res.data as (AdjustOk & { error?: string }) | null;
    if (!res.ok || !data || !data.artifact) {
      setError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
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
    <section aria-label="Adjust this recipe">
      <h2>Adjust this recipe</h2>
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
          <label className="field">
            <span>Cuisine style</span>
            <input
              type="text"
              placeholder="e.g. Italian"
              value={cuisine}
              disabled={applying}
              onChange={(e) => setCuisine(e.target.value)}
            />
          </label>
          <label className="check-row">
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
        <div className="card">
          <p>
            <strong>What changed:</strong> {summary}
          </p>
          {flags.length > 0 ? (
            <ul className="changes">
              {flags.map((f, i) => (
                <li key={`${f.stepId}-${i}`}>
                  Step {f.stepId}: “{f.token}” was left as printed — check it yourself.
                </li>
              ))}
            </ul>
          ) : null}
          <p className="meta">Full details are in the What changed list above.</p>
        </div>
      ) : null}
    </section>
  );
}
