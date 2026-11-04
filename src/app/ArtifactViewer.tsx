"use client";

import { useMemo, useState } from "react";
import type { ArtifactChange, CookAlongArtifact } from "../lib/schema/artifact";
import { buildImportUrl } from "../lib/handoff";
import { applyArtifactAllergenFloor, rollUpTraces } from "../lib/allergens";
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

function formatAmount(quantity: string, unit: string): string {
  return `${quantity} ${unit}`.trim();
}

export default function ArtifactViewer({
  artifact,
  onStartOver,
}: {
  artifact: CookAlongArtifact;
  onStartOver: () => void;
}) {
  // Allergen floor on display too, so artifacts saved before it existed
  // (cache, ?src=) show inferred tags; Save sends the floored artifact.
  const floored = useMemo(() => applyArtifactAllergenFloor(artifact), [artifact]);
  const [current, setCurrent] = useState(floored);
  const [modified, setModified] = useState(false);
  const [prepDone, setPrepDone] = useState<Set<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<FriendlyError | null>(null);

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
    setSaveBusy(true);
    setSaveError(null);
    const res = await apiFetch("/api/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: current }),
    });
    const data = res.data as { url?: string; error?: string } | null;
    if (!res.ok || !data || !data.url) {
      setSaveError(friendlyError(res.status, data?.error ?? "", { timeout: res.timeout }));
      setSaveBusy(false);
      return;
    }
    setSaveBusy(false);
    window.location.href = buildImportUrl(data.url);
  }

  return (
    <article aria-label="Cook Along recipe">
      <h2>{recipe.title}</h2>
      <p className="meta">
        Serves {recipe.servings} · {recipe.ingredients.length} ingredients
        {totalMinutes !== null ? ` · About ${totalMinutes} minutes` : ""}
        {recipe.methodLabel ? ` · Method: ${recipe.methodLabel}` : ""}
      </p>

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
      <p className="meta">
        {recipe.equipment.length > 0
          ? `Equipment: ${recipe.equipment.join(", ")}`
          : "No equipment listed."}
      </p>

      <h3>Mise en Place</h3>
      {prepTasks.length > 0 ? (
        <ul className="prep-list">
          {prepTasks.map((task) => (
            <li key={task.id}>
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
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No prep tasks — everything happens at the stove.</p>
      )}

      <h3>Timeline</h3>
      <TimelineView timeline={timeline} />

      <h3>Steps</h3>
      {cookTasks.map((task, i) => (
        <div key={task.id} className="step">
          <h4>
            {i + 1}. {task.cardTitle.action} — {task.cardTitle.subject}
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
          {task.tip ? <p>Tip: {task.tip}</p> : null}
          <Timer minutes={task.minutes} label={task.label} />
        </div>
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
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={saveToTextSous} disabled={saveBusy}>
          {saveBusy ? "Saving…" : "Save to TextSous"}
        </button>
        <button type="button" className="btn" onClick={onStartOver}>
          Convert another recipe
        </button>
      </div>
      <p className="meta">Saving keeps the recipe for 24 hours so TextSous can import it.</p>
    </article>
  );
}
