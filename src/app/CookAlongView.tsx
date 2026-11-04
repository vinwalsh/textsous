"use client";

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
 */
export default function CookAlongView({
  input,
  adjusting = null,
}: {
  input: CookingPilotInput | null;
  adjusting?: string | null;
}) {
  if (!input) return null;
  return (
    <section className={styles.body} aria-label="Cook Along">
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
