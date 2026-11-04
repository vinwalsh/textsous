"use client";

import { useEffect, useState } from "react";

export type ProgressKind = "convert" | "transcribe" | "adjust";

/**
 * Plain-words explainer for a long request. The client cannot see server
 * stages, so this is approximate by design — reassurance, not a progress bar.
 */
export function progressCopy(kind: ProgressKind): string {
  switch (kind) {
    case "convert":
      return "Usually 3 to 4 minutes: reading the recipe, planning the timeline, then checking it. Keep this page open.";
    case "transcribe":
      return "Usually 1 to 2 minutes: reading the photo, then writing out the recipe.";
    case "adjust":
      return "Usually under a minute: applying your changes.";
  }
}

/** "1:05" for 65 seconds. Pure. */
export function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Ticking elapsed time plus the honest stage explainer. */
export default function ProgressNote({ kind }: { kind: ProgressKind }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <p className="meta" aria-live="polite">
      {progressCopy(kind)} Elapsed {formatElapsed(elapsed)}.
    </p>
  );
}
