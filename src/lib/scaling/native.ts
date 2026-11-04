import type { ArtifactChange } from "../schema/artifact";

/**
 * Servings the printed quantities are written for. Artifacts compiled since
 * nativeServings existed carry it; older ones fall back to the first
 * "rescaled X → Y" change, then to the current servings (never scaled).
 */
export function nativeServingsOf(
  recipe: { servings: number; nativeServings?: number | null },
  changes: ArtifactChange[],
): number {
  if (typeof recipe.nativeServings === "number" && recipe.nativeServings > 0) {
    return recipe.nativeServings;
  }
  for (const change of changes) {
    if (change.kind !== "scale") continue;
    const match = /^rescaled (\d+(?:\.\d+)?) →/.exec(change.detail);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return recipe.servings;
}
