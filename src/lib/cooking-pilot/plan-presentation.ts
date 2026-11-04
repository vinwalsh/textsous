import { formatCookingCardTitle } from "./card-title";
import type { CookingPlan, CookingTimelineDefinition } from "./plan";

/** Resolve titles once for cards, details, timer names, adjustment labels and
 * layout sizing. The input definition remains byte-identical: title-only copy
 * must not reset an existing cook or its exact-context timing preferences.
 * Existing artifacts without title metadata retain their authored labels. */
export function presentCookingPlan(plan: CookingPlan, definition: CookingTimelineDefinition): CookingPlan {
  if (plan.sourceFingerprint !== definition.sourceFingerprint || plan.version !== definition.revision
    || plan.definitionId !== definition.id || plan.servings !== definition.servings) return plan;
  const authored = new Map(definition.tasks.map(task => [task.id, task]));
  return { ...plan, tasks: plan.tasks.map(task => {
    const original = authored.get(task.id);
    if (!original) return task;
    const title = original.cardTitle;
    return title ? { ...task, label: formatCookingCardTitle(title) } : task;
  }) };
}
