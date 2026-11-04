import { z } from "zod/v3";

/** Author against the effective instructions, after serving/dietary changes.
 * Name the action and its food/equipment; add the destination or purpose when
 * needed to act without opening details. Lane tags cannot supply this context.
 * Keep durations in the timer/duration row, not in the title. */
export const cookingCardTitleSchema = z.object({
  action: z.string().trim().min(1).max(60),
  subject: z.string().trim().min(1).max(120),
  context: z.string().trim().min(1).max(160).optional(),
}).strict();

export type CookingCardTitle = z.infer<typeof cookingCardTitleSchema>;

/** One formatter for every recipe and surface. No food, temperature,
 * destination, or timing is guessed from a task ID, lane, or equipment list. */
export function formatCookingCardTitle(title: CookingCardTitle): string {
  return [title.action, title.subject, title.context].filter(Boolean).join(" ");
}
