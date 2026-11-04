"use client";

import { CookingPilot } from "@/components/cooking-pilot/cooking-pilot";
import type { CookingPilotInput } from "@/lib/cooking-pilot/from-artifact";
import styles from "./CookAlongView.module.css";

/**
 * The Cook Along body of the finished page: the TextSous app's Cook Along
 * view (component swimlanes, a guided timeline from Mise en Place to
 * serving, step cards that open with details and timers). The caller
 * adapts the artifact with cookingPilotInput (src/lib/cooking-pilot/
 * from-artifact.ts) and shows its own sections when that returns null.
 */
export default function CookAlongView({ input }: { input: CookingPilotInput | null }) {
  if (!input) return null;
  return (
    <section className={styles.body} aria-label="Cook Along">
      <CookingPilot embedded recipe={input.recipe} timelineDefinition={input.timelineDefinition} />
    </section>
  );
}
