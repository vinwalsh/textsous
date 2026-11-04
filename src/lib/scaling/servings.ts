/**
 * The servings a cook along can be rescaled to. Client-safe (no model or
 * Node imports), so the adjust panel, the adjust route and the scaling stage
 * share one range. 36 covers a double batch of a dozen-muffin recipe and
 * three dozen cookies.
 */
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 36;

export function servingsInRange(servings: number): boolean {
  return servings >= MIN_SERVINGS && servings <= MAX_SERVINGS;
}
