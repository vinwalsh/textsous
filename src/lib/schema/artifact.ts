import { z } from "zod";
import { toResponseJsonSchema } from "./json";
import {
  AllergenSchema,
  CanonicalIngredientSchema,
  CanonicalStepSchema,
  SourceKindSchema,
} from "./canonical";
import { TimelineDefinitionSchema } from "./timeline";

export const ArtifactCreditSchema = z.strictObject({
  kind: SourceKindSchema,
  site: z.string().nullish(),
  author: z.string().nullish(),
  url: z.string().nullish(),
  book: z.string().nullish(),
  page: z.number().int().positive().nullish(),
  license: z.string().nullish(),
});

// Kitchen capacity the schedule was built for: burner count and oven presence
// are the constraints the procedure and review stages reason about.
export const EquipmentProfileSchema = z.strictObject({
  burners: z.number().int().min(0),
  oven: z.boolean(),
});

export const ArtifactChangeKindSchema = z.enum(["merged-steps", "estimate"]);

export const ArtifactChangeSchema = z.strictObject({
  kind: ArtifactChangeKindSchema,
  detail: z.string().min(1),
});

export const ArtifactRecipeSchema = z.strictObject({
  title: z.string().min(1),
  servings: z.number().positive(),
  ingredients: z.array(CanonicalIngredientSchema).min(1),
  equipment: z.array(z.string()),
  steps: z.array(CanonicalStepSchema).min(1),
  allergens: z.array(AllergenSchema),
  originalMethod: z.string(),
  methodLabel: z.string(),
  methodNotice: z.string(),
  credit: ArtifactCreditSchema,
});

export const CookAlongArtifactSchema = z.strictObject({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  recipe: ArtifactRecipeSchema,
  timelineDefinition: TimelineDefinitionSchema,
  equipmentProfile: EquipmentProfileSchema,
  changes: z.array(ArtifactChangeSchema),
});

export type ArtifactCredit = z.infer<typeof ArtifactCreditSchema>;
export type EquipmentProfile = z.infer<typeof EquipmentProfileSchema>;
export type ArtifactChange = z.infer<typeof ArtifactChangeSchema>;
export type ArtifactRecipe = z.infer<typeof ArtifactRecipeSchema>;
export type CookAlongArtifact = z.infer<typeof CookAlongArtifactSchema>;

export const ARTIFACT_SCHEMA_NAME = "cook_along_artifact_v1";

/** Inlined JSON Schema (no $ref) for response_format and docs/schema. */
export function artifactResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(CookAlongArtifactSchema);
}
