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

/** Longest cuisine target an adjustment accepts ("Italian", "Thai street food"). */
export const MAX_CUISINE_CHARS = 80;

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

// Rewritten step-card text for a timeline task that mentions a swapped or
// removed ingredient. Only the fields that change are set; code keeps timing
// numbers unchanged and refuses text that names a removed ingredient.
export const TaskOverrideSchema = z.strictObject({
  taskId: z.string().min(1),
  label: z.string().min(1).nullish(),
  description: z.string().min(1).nullish(),
  completionCue: z.string().min(1).nullish(),
  checkpoints: z.array(z.string().min(1)).nullish(),
});

export const VariantTransformSchema = z.strictObject({
  kind: VariantKindSchema,
  target: z.string().min(1),
  titleOverride: z.string().nullish(),
  swaps: z.array(VariantSwapSchema),
  stepOverrides: z.array(StepOverrideSchema),
  // Additive (stage v2): older transforms and recordings omit it.
  taskOverrides: z.array(TaskOverrideSchema).nullish(),
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
export type TaskOverride = z.infer<typeof TaskOverrideSchema>;
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
