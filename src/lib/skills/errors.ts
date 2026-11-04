/** Error and warning shapes returned by the skills API (contract C3.3). */

export interface SkillsError {
  /** Where to fix it, e.g. "timeline.tasks[3].sourceStepIds". */
  path: string;
  code: SkillsErrorCode;
  /** One actionable sentence telling the assistant how to fix it. */
  message: string;
}

export interface SkillsWarning {
  code: string;
  message: string;
  path?: string;
}

/**
 * Every error code the save call can return, with the fix. The instructions
 * render this table, so the assistant always sees the current list.
 */
export const ERROR_FIXES = {
  invalid_body: "Send one JSON object with source, recipe and timeline.",
  invalid_value: "Give the field the type and value the message names, then send the whole body again.",
  missing_source_text: "Put the recipe text you worked from in source.text (for a photo, the confirmed transcription).",
  refused_url: "source.url must be a public https link to the recipe page.",
  duplicate_id: "Give every ingredient, step, lane, task and resource its own id, or leave ids out and let the server number them.",
  unknown_reference: "Use an id that exists: step ids from recipe.steps, lane ids from timeline.lanes, task ids from timeline.tasks, ingredient ids from recipe.ingredients, resource ids from timeline.resources.",
  self_dependency: "Remove the task's own id from its dependencies.",
  dependency_cycle: "Break the loop: a task cannot (even indirectly) wait for itself.",
  prep_depends_on_cook: "Prep tasks are mise en place and may only depend on other prep tasks; move the task to cook, or drop the dependency.",
  lanes: "Use at least one component lane and exactly one kitchen lane, and put the kitchen lane last.",
  quote_missing: 'A "source" timing needs sourceQuote: the exact words that state the time. Otherwise set timingBasis to "estimate".',
  quote_not_in_steps: "Copy sourceQuote character for character from one step's text, or set timingBasis to \"estimate\" and drop the quote.",
  quote_not_in_source: "The quote must appear in the original recipe text, not only in your steps. Copy it exactly, or set timingBasis to \"estimate\".",
  numbers_in_card_title: "Card titles never carry amounts, times or temperatures; move them into the description.",
  range_order: "Give range.low no greater than range.high.",
  unused_ingredient: "Add the ingredient's id to ingredientIds of the task that uses it (often a prep task and the task that adds it).",
  needs_checkpoints: "Give a hands-on task longer than 15 minutes observable checkpoints, or split it into shorter tasks.",
  procedure_check: "Fix the timeline so the named procedure rule holds.",
  review_check: "Fix the timeline so the named review rule holds.",
  schedule_failed: "Fix dependencies and phases so the tasks can be scheduled in order.",
} as const;

export type SkillsErrorCode = keyof typeof ERROR_FIXES;

export function skillsError(path: string, code: SkillsErrorCode, message: string): SkillsError {
  return { path, code, message };
}
