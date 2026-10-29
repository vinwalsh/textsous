import { z } from "zod";
import { toResponseJsonSchema } from "./json";

export const VariantKindSchema = z.enum(["dietary", "cuisine"]);

export const DIETARY_TARGETS = [
  "dairy-free",
  "egg-free",
  "gluten-free",
  "nut-free",
  "soy-free",
  "vegetarian",
  "vegan",
] as const;

export const DietaryTargetSchema = z.enum(DIETARY_TARGETS);

export const VariantSwapToSchema = z.strictObject({
  name: z.string().min(1),
  quantity: z.string(),
  unit: z.string(),
});

export const VariantSwapSchema = z.strictObject({
  fromIngredientId: z.string().min(1),
  // Replacement, or null to omit the ingredient (with omitReason).
  to: VariantSwapToSchema.nullish(),
  omitReason: z.string().nullish(),
  reason: z.string().min(1),
  // Label statements the cook must verify when buying the replacement.
  packageRequirements: z.array(z.string().min(1)),
});

export const StepOverrideSchema = z.strictObject({
  stepId: z.string().min(1),
  text: z.string().min(1),
});

export const VariantTransformSchema = z.strictObject({
  kind: VariantKindSchema,
  target: z.string().min(1),
  titleOverride: z.string().nullish(),
  swaps: z.array(VariantSwapSchema),
  stepOverrides: z.array(StepOverrideSchema),
  techniqueChanges: z.array(z.string().min(1)),
  rationale: z.array(z.string().min(1)),
});

export const DietaryVariantTransformSchema = VariantTransformSchema.extend({
  kind: z.literal("dietary"),
  target: DietaryTargetSchema,
});

export const CuisineVariantTransformSchema = VariantTransformSchema.extend({
  kind: z.literal("cuisine"),
  target: z.string().min(1),
});

export type VariantSwap = z.infer<typeof VariantSwapSchema>;
export type StepOverride = z.infer<typeof StepOverrideSchema>;
export type VariantTransform = z.infer<typeof VariantTransformSchema>;
export type DietaryVariantTransform = z.infer<typeof DietaryVariantTransformSchema>;
export type CuisineVariantTransform = z.infer<typeof CuisineVariantTransformSchema>;

export const DIETARY_SCHEMA_NAME = "dietary_transform_v1";
export const CUISINE_SCHEMA_NAME = "cuisine_transform_v1";

/** Inlined JSON Schemas (no $ref) for response_format. */
export function dietaryResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(DietaryVariantTransformSchema);
}

export function cuisineResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(CuisineVariantTransformSchema);
}

export function variantResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(VariantTransformSchema);
}
