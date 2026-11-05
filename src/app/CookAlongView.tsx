"use client";

import { useEffect, useRef } from "react";
import { CookingPilot } from "@/components/cooking-pilot/cooking-pilot";
import type { CookingPilotInput } from "@/lib/cooking-pilot/from-artifact";
import { PreAdjustMark } from "./SectionStatus";
import styles from "./CookAlongView.module.css";

/**
 * The Cook Along body of the finished page: the TextSous app's Cook Along
 * view (component swimlanes, a guided timeline from Mise en Place to
 * serving, step cards that open with details and timers). It opens on the
 * swimlanes, so Cook is in view; Read this First is one tab away. The caller
 * adapts the artifact with cookingPilotInput (src/lib/cooking-pilot/
 * from-artifact.ts) and shows its own sections when that returns null.
 * While an adjustment applies (`adjusting`, the "Adjusting: ..." line), one
 * "Before your changes" mark sits above the view, and the view says what
 * is changing and holds Cook and timing edits until the new plan shows.
 * `reveal`: the cook along was just built or opened on this page, so the
 * view scrolls into sight once (not under prefers-reduced-motion), with the
 * Cook button in view instead of a screen below the facts.
 */
export default function CookAlongView({
  input,
  adjusting = null,
  reveal = false,
}: {
  input: CookingPilotInput | null;
  adjusting?: string | null;
  reveal?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!reveal || !ref.current) return;
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }, 150);
    return () => window.clearTimeout(id);
  }, [reveal]);
  if (!input) return null;
  return (
    <section ref={ref} className={styles.body} aria-label="Cook Along">
      {adjusting ? <PreAdjustMark /> : null}
      <CookingPilot
        embedded
        initialTab="timeline"
        recipe={input.recipe}
        timelineDefinition={input.timelineDefinition}
        timelinePending={adjusting !== null}
        timelineNotice={adjusting ? `${adjusting} Press Cook once the new plan shows.` : undefined}
      />
    </section>
  );
}
