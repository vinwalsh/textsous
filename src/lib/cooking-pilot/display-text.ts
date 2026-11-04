/** Presentation only for known legacy authoring commentary (none in the open
 * format yet). Keep the stored method, source binding, schedule, and
 * originalMethod unchanged. Each substitution is literal: unfamiliar recipe
 * instructions pass through. */
const LEGACY_COOKING_COPY: ReadonlyArray<readonly [string, string]> = [];

export function cookingDisplayText(text: string): string {
  return LEGACY_COOKING_COPY.reduce((copy, [before, after]) => copy.replaceAll(before, after), text);
}
