/** One portion-value contract for recipe controls, cooking plans and shares.
 * Ingredient measuring rules remain separate. */
import { z } from "zod/v3";
import { MAX_SERVINGS, MIN_SERVINGS } from "@/lib/scaling/servings";

// The open format's servings range (src/lib/scaling/servings.ts): 0.5 to 36.
export const MIN_RECIPE_SERVINGS = MIN_SERVINGS;
export const MAX_RECIPE_SERVINGS = MAX_SERVINGS;

export function roundRecipeServings(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const recipeServingsSchema = z.number().finite().min(MIN_RECIPE_SERVINGS).max(MAX_RECIPE_SERVINGS)
  .refine(value => Math.abs(value - roundRecipeServings(value)) < 1e-9, "Use at most two decimal places for servings")
  .transform(roundRecipeServings);

export function isRecipeServings(value: unknown): value is number {
  return recipeServingsSchema.safeParse(value).success;
}

/** Legacy/default values normalize once; explicit input uses the strict schema. */
export function normalizeRecipeServings(value: number, fallback = 2, minimum = MIN_RECIPE_SERVINGS, maximum = MAX_RECIPE_SERVINGS): number {
  const finite = Number.isFinite(value) && value > 0 ? value : Number.isFinite(fallback) && fallback > 0 ? fallback : 2;
  return roundRecipeServings(Math.min(maximum, Math.max(minimum, finite)));
}
