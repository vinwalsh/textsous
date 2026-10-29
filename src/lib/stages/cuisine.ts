import {
  CUISINE_SCHEMA_NAME,
  CuisineVariantTransformSchema,
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

export const CUISINE_VERSION = 1;

export interface CuisinableRecipe {
  title: string;
  servings: number;
  method: string;
  ingredients: Array<{ id: string; name: string; quantity: string; unit: string }>;
  steps: Array<{ id: string; text: string }>;
}

const SYSTEM_PROMPT = `You infuse a recipe with a target cuisine while keeping the dish's identity and cooking method. Rules:
- Swap at most a third of the ingredients. Prefer aromatics, fats, acids, herbs and finishing touches; leave the core structure alone.
- Keep every duration word-for-word identical: no timing may change. Step overrides touch only steps that mention a swapped ingredient.
- List method tweaks in techniqueChanges, never inside steps. Give a one-sentence rationale per swap, plus the per-swap reason.
- Every swap lists packageRequirements the cook must verify on the label.
- titleOverride only when the dish name no longer fits.
- Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(
  recipe: CuisinableRecipe,
  target: string,
  priorVariant: string | null,
  forbiddenNames: string[],
): string {
  return JSON.stringify({
    target,
    currentMethod: recipe.method,
    priorVariant,
    forbiddenIngredients: forbiddenNames,
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
  });
}

export interface PlannedCuisine {
  transform: VariantTransform;
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

/** One model call producing the cuisine transform. Code applies it. */
export async function planCuisine(
  recipe: CuisinableRecipe,
  target: string,
  opts: {
    provider?: ProviderName;
    client?: StructuredChatClient;
    priorVariant?: string | null;
    forbiddenNames?: string[];
  } = {},
): Promise<PlannedCuisine> {
  if (!target.trim()) throw new Error("cuisine target must not be empty");
  const result = await callStructured(
    CuisineVariantTransformSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(
          recipe,
          target,
          opts.priorVariant ?? null,
          opts.forbiddenNames ?? [],
        ),
      },
    ],
    { provider: opts.provider, schemaName: CUISINE_SCHEMA_NAME, client: opts.client },
  );
  return {
    transform: result.data,
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
  };
}

export interface AppliedCuisine extends ApplyVariantResult {
  transform: VariantTransform;
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

/**
 * Plan a cuisine infusion for an artifact and apply it in code. Refuses
 * transforms that swap more than a third of the ingredients; the shared
 * applier refuses timing changes and reintroductions of earlier-removed
 * ingredients, so a dietary variant applied earlier still holds.
 */
export async function applyCuisine(
  artifact: CookAlongArtifact,
  target: string,
  opts: {
    provider?: ProviderName;
    client?: StructuredChatClient;
    forbiddenNames?: string[];
    priorVariant?: string | null;
  } = {},
): Promise<AppliedCuisine> {
  const recipe = artifact.recipe;
  const planned = await planCuisine(
    {
      title: recipe.title,
      servings: recipe.servings,
      method: recipe.methodLabel || recipe.originalMethod,
      ingredients: recipe.ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
      })),
      steps: recipe.steps.map((s) => ({ id: s.id, text: s.text })),
    },
    target,
    opts,
  );
  const budget = Math.floor(recipe.ingredients.length / 3);
  if (planned.transform.swaps.length > budget) {
    throw new Error(
      `refuses: ${planned.transform.swaps.length} swaps exceed a third of ${recipe.ingredients.length} ingredients`,
    );
  }
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
