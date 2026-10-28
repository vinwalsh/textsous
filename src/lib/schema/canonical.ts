import { z } from "zod";
import { toResponseJsonSchema } from "./json";

// EU-14 allergen codes, frozen for format v1. Short lowercase slugs:
// celery, gluten (cereals containing gluten), crustaceans, egg, fish,
// lupin, milk (incl. lactose), molluscs, mustard, nuts (tree nuts),
// peanuts, sesame, soy, sulphites.
export const EU14_ALLERGENS = [
  "celery",
  "gluten",
  "crustaceans",
  "egg",
  "fish",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "nuts",
  "peanuts",
  "sesame",
  "soy",
  "sulphites",
] as const;

export type Eu14Allergen = (typeof EU14_ALLERGENS)[number];

export const SourceKindSchema = z.enum(["url", "text", "photo"]);
export const ScaleRuleSchema = z.enum([
  "linear",
  "sublinear",
  "flat",
  "superlinear",
  "to-taste",
]);
export const StepKindSchema = z.enum(["prep", "active"]);
export const AllergenSchema = z.enum(EU14_ALLERGENS);

export const CanonicalSourceSchema = z.strictObject({
  kind: SourceKindSchema,
  url: z.string().nullish(),
  site: z.string().nullish(),
  author: z.string().nullish(),
  book: z.string().nullish(),
  page: z.number().int().positive().nullish(),
  license: z.string().nullish(),
});

export const CanonicalIngredientSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  // Free text exactly as printed, e.g. "1 1/2". Empty when the source
  // gives no amount (season to taste).
  quantity: z.string(),
  unit: z.string(),
  // Normalized quantity for 4 servings; computed by code, not the model.
  quantity4: z.number().nullish(),
  scaleRule: ScaleRuleSchema.nullish(),
  allergens: z.array(AllergenSchema),
  allergenTraces: z.array(AllergenSchema),
  note: z.string().nullish(),
});

export const CanonicalStepSchema = z.strictObject({
  id: z.string().min(1),
  kind: StepKindSchema,
  text: z.string().min(1),
});

export const CanonicalRecipeSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  source: CanonicalSourceSchema,
  cuisine: z.string().nullish(),
  nativeServings: z.number().positive(),
  servingsLarge: z.number().positive().nullish(),
  scalingNotes: z.string().nullish(),
  ingredients: z.array(CanonicalIngredientSchema).min(1),
  // Prep steps are mise en place and are SEPARATE from ordered active steps.
  steps: z.array(CanonicalStepSchema).min(1),
  equipment: z.array(z.string()),
  sourceFingerprint: z.string().min(1),
});

export type CanonicalSource = z.infer<typeof CanonicalSourceSchema>;
export type CanonicalIngredient = z.infer<typeof CanonicalIngredientSchema>;
export type CanonicalStep = z.infer<typeof CanonicalStepSchema>;
export type CanonicalRecipe = z.infer<typeof CanonicalRecipeSchema>;

export const CANONICAL_SCHEMA_NAME = "canonical_recipe_v1";

/** Inlined JSON Schema (no $ref) for response_format. */
export function canonicalResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(CanonicalRecipeSchema);
}
