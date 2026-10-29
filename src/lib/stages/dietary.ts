import {
  DIETARY_SCHEMA_NAME,
  DIETARY_TARGETS,
  DietaryVariantTransformSchema,
  type VariantTransform,
} from "../schema/variant";
import type { CookAlongArtifact } from "../schema/artifact";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { applyVariant, type ApplyVariantResult } from "../variant-apply";

export const DIETARY_VERSION = 1;

export type DietaryTarget = (typeof DIETARY_TARGETS)[number];

export interface DietableRecipe {
  title: string;
  servings: number;
  ingredients: Array<{
    id: string;
    name: string;
    quantity: string;
    unit: string;
    allergens: string[];
  }>;
  steps: Array<{ id: string; text: string }>;
}

const TARGET_GUIDANCE: Record<DietaryTarget, string> = {
  "dairy-free": "Avoid milk, butter, cheese, cream, yogurt, whey and lactose.",
  "egg-free": "Avoid eggs and ingredients made with egg (mayonnaise, fresh pasta, meringue).",
  "gluten-free":
    "Avoid wheat, barley, rye, flour, bread, pasta, couscous and soy sauce unless certified gluten-free.",
  "nut-free": "Avoid tree nuts and peanuts, including oils, flours and butters made from them.",
  "soy-free": "Avoid soybeans, tofu, soy sauce, miso and soybean oil.",
  vegetarian: "Avoid meat, poultry, fish and seafood; dairy and eggs stay.",
  vegan: "Avoid all animal products: meat, dairy, eggs and honey.",
};

const SYSTEM_PROMPT = `You adapt a recipe to a dietary target with minimal changes. Rules:
- Swap ONLY ingredients that violate the target, for the closest functional equivalent at the same quantity and scale. Prefer omitting (with omitReason) only when nothing replaces an item.
- Every swap lists packageRequirements: the exact label statements the cook must verify (certifications, "no X ingredients", facility warnings).
- stepOverrides touch ONLY steps that mention a swapped ingredient, keep every duration word-for-word identical, and never change timings.
- List method tweaks in techniqueChanges, never inside steps. Give a one-sentence rationale per swap, plus the per-swap reason.
- titleOverride only when the dish name no longer fits the adapted recipe.
- Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(recipe: DietableRecipe, target: DietaryTarget): string {
  return JSON.stringify({
    target,
    guidance: TARGET_GUIDANCE[target],
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
  });
}

export interface PlannedDietary {
  transform: VariantTransform;
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

/** One model call producing the dietary transform. Code applies it. */
export async function planDietary(
  recipe: DietableRecipe,
  target: string,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<PlannedDietary> {
  if (!(DIETARY_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`unknown dietary target "${target}"`);
  }
  const result = await callStructured(
    DietaryVariantTransformSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(recipe, target as DietaryTarget) },
    ],
    { provider: opts.provider, schemaName: DIETARY_SCHEMA_NAME, client: opts.client },
  );
  return {
    transform: result.data,
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
  };
}

export interface AppliedDietary extends ApplyVariantResult {
  transform: VariantTransform;
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

/** Plan a dietary transform for an artifact and apply it in code. */
export async function applyDietary(
  artifact: CookAlongArtifact,
  target: string,
  opts: { provider?: ProviderName; client?: StructuredChatClient; forbiddenNames?: string[] } = {},
): Promise<AppliedDietary> {
  const recipe = artifact.recipe;
  const planned = await planDietary(
    {
      title: recipe.title,
      servings: recipe.servings,
      ingredients: recipe.ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        allergens: [...i.allergens],
      })),
      steps: recipe.steps.map((s) => ({ id: s.id, text: s.text })),
    },
    target,
    opts,
  );
  const applied = applyVariant(artifact, planned.transform, {
    forbiddenNames: opts.forbiddenNames,
  });
  return {
    ...applied,
    transform: planned.transform,
    usage: planned.usage,
    fallbackUsed: planned.fallbackUsed,
    attempts: planned.attempts,
  };
}
