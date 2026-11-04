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

export const ArtifactChangeKindSchema = z.enum([
  "merged-steps",
  "estimate",
  "scale",
  "swap",
  "technique",
]);

export const ArtifactChangeSchema = z.strictObject({
  kind: ArtifactChangeKindSchema,
  detail: z.string().min(1),
});

/**
 * Review checks the model judges that inform the cook but never block
 * compile: how equipment is shared, the order of the steps, and the tips and
 * cues. The fidelity and safety judgments and every coded check still block.
 */
export const ADVISORY_REVIEW_CHECKS = [
  "equipment_capacity",
  "source_relationships",
  "tips_and_voice",
] as const;

export type AdvisoryReviewCheck = (typeof ADVISORY_REVIEW_CHECKS)[number];

// One advisory finding: the check failed ("failed") or the review gave no
// judgment for it ("not_judged"). `detail` is a readable sentence for the cook.
export const ArtifactReviewNoteSchema = z.strictObject({
  check: z.enum(ADVISORY_REVIEW_CHECKS),
  status: z.enum(["failed", "not_judged"]),
  detail: z.string().min(1),
});

export const ArtifactRecipeSchema = z.strictObject({
  title: z.string().min(1),
  servings: z.number().positive(),
  // Servings the printed ingredient quantities are written for. Scaling
  // always starts from here, so 2 -> 4 -> 6 equals 2 -> 6. Optional for
  // artifacts compiled before it existed.
  nativeServings: z.number().positive().nullish(),
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
  // Advisory review findings shown to the cook as notes. Optional: absent
  // when the review raised none and on artifacts compiled before it existed.
  reviewNotes: z.array(ArtifactReviewNoteSchema).nullish(),
});

export type ArtifactCredit = z.infer<typeof ArtifactCreditSchema>;
export type EquipmentProfile = z.infer<typeof EquipmentProfileSchema>;
export type ArtifactChange = z.infer<typeof ArtifactChangeSchema>;
export type ArtifactReviewNote = z.infer<typeof ArtifactReviewNoteSchema>;
export type ArtifactRecipe = z.infer<typeof ArtifactRecipeSchema>;
export type CookAlongArtifact = z.infer<typeof CookAlongArtifactSchema>;

export const ARTIFACT_SCHEMA_NAME = "cook_along_artifact_v1";

/** Inlined JSON Schema (no $ref) for response_format and docs/schema. */
export function artifactResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(CookAlongArtifactSchema);
}
