import { z } from "zod";
import { ScaleRuleSchema } from "../schema/canonical";
import type { CookAlongArtifact } from "../schema/artifact";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { parseAmount } from "../scaling/amounts";
import { effectiveFactor, formatAmount, round2, scaleIngredient } from "../scaling/scale";
import { nativeServingsOf } from "../scaling/native";
import { rescaleText, type AmountMapping } from "../scaling/text";

export const SCALING_VERSION = 2;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 12;

export const ScaleRuleAssignmentSchema = z.strictObject({
  ingredientId: z.string().min(1),
  rule: ScaleRuleSchema,
  reason: z.string().min(1),
});

export const ScaleRulesSchema = z.strictObject({
  rules: z.array(ScaleRuleAssignmentSchema).min(1),
});

export const SCALING_SCHEMA_NAME = "scaling_rules_v1";

export type ScaleRuleAssignment = z.infer<typeof ScaleRuleAssignmentSchema>;

export interface ScalableRecipe {
  title: string;
  servings: number;
  ingredients: Array<{ id: string; name: string; quantity: string; unit: string }>;
  steps: Array<{ id: string; text: string }>;
}

export interface AssignedRules {
  rules: ScaleRuleAssignment[];
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

const SYSTEM_PROMPT = `You assign a scaling rule to every ingredient in a recipe. Rules:
- linear: the default; amount grows with servings (mains, grains, most vegetables).
- sublinear: strong flavors that grow slower than servings (spices, salt that cooks in, leaveners).
- flat: amounts independent of servings (oil for the pan, water for boiling).
- superlinear: amounts that grow faster than servings (large-batch cooking liquid).
- to-taste: seasoned at the table (salt and pepper to taste, garnishes to liking).
Assign exactly one rule per ingredient id, with a short reason each. Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(recipe: ScalableRecipe): string {
  return JSON.stringify({
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
  });
}

/** One model call assigning a rule and reason per ingredient. Code does all the math. */
export async function assignScaleRules(
  recipe: ScalableRecipe,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<AssignedRules> {
  const result = await callStructured(
    ScaleRulesSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(recipe) },
    ],
    { provider: opts.provider, schemaName: SCALING_SCHEMA_NAME, client: opts.client },
  );
  return {
    rules: result.data.rules,
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
  };
}

export interface ScaleFlag {
  stepId: string;
  token: string;
}

export interface ApplyScalingResult {
  artifact: CookAlongArtifact;
  flags: ScaleFlag[];
}

/**
 * Rescale an artifact to a target servings count. Servings must stay within
 * 0.5-12. Amounts always scale from the printed quantity at nativeServings
 * (factor = target / nativeServings), so 2 -> 4 -> 6 equals 2 -> 6. Numbers
 * in step and task text that read as an ingredient's current amount (the
 * number directly followed by its unit or name) are rescaled; times,
 * temperatures and pan sizes never are. Other amount-like numbers in steps
 * are flagged for the cook to verify. Pure.
 */
export function applyScaling(
  artifact: CookAlongArtifact,
  targetServings: number,
  rules: ScaleRuleAssignment[],
): ApplyScalingResult {
  if (!(targetServings >= MIN_SERVINGS && targetServings <= MAX_SERVINGS)) {
    throw new Error(`servings ${targetServings} out of range (${MIN_SERVINGS}-${MAX_SERVINGS})`);
  }
  const recipe = artifact.recipe;
  const native = nativeServingsOf(recipe, artifact.changes);
  const factor = targetServings / native;
  const byId = new Map(rules.map((r) => [r.ingredientId, r.rule] as const));
  const missing = recipe.ingredients.map((i) => i.id).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`missing scale rule for ${missing.join(", ")}`);
  }
  const mappings: AmountMapping[] = [];
  const ingredients = recipe.ingredients.map((ingredient) => {
    const rule = byId.get(ingredient.id) ?? "linear";
    const scaled = scaleIngredient({ ...ingredient, scaleRule: rule }, factor);
    const original = parseAmount(ingredient.quantity);
    const current = parseAmount(ingredient.cookQuantity ?? ingredient.quantity);
    if (scaled.scaled && original !== null && current !== null) {
      const eff = effectiveFactor(rule, factor);
      const ends: Array<[number, number]> =
        original.low === original.high
          ? [[current.low, original.low]]
          : [
              [current.low, original.low],
              [current.high, original.high],
            ];
      for (const [now, base] of ends) {
        mappings.push({
          current: now,
          next: round2(base * eff),
          unit: ingredient.unit,
          name: ingredient.name,
        });
      }
    }
    return {
      ...ingredient,
      scaleRule: rule,
      cookQuantity: scaled.cook.quantity,
      buyQuantity: scaled.buy.quantity,
    };
  });
  const flags: ScaleFlag[] = [];
  const steps = recipe.steps.map((step) => {
    const rescaled = rescaleText(step.text, mappings);
    flags.push(...rescaled.unmatched.map((token) => ({ stepId: step.id, token })));
    return { ...step, text: rescaled.text };
  });
  // Step cards render task text, so amounts there scale too (no flags:
  // the steps already report anything left unscaled).
  const rescale = (text: string): string => rescaleText(text, mappings).text;
  const tasks = artifact.timelineDefinition.tasks.map((task) => ({
    ...task,
    label: rescale(task.label),
    description: rescale(task.description),
    completionCue: rescale(task.completionCue),
    checkpoints: task.checkpoints.map(rescale),
  }));
  return {
    artifact: {
      ...artifact,
      recipe: {
        ...recipe,
        servings: targetServings,
        nativeServings: native,
        ingredients,
        steps,
      },
      timelineDefinition: { ...artifact.timelineDefinition, tasks },
      changes: [
        ...artifact.changes,
        {
          kind: "scale" as const,
          detail: `rescaled ${recipe.servings} → ${targetServings} servings (×${formatAmount(targetServings / recipe.servings)})`,
        },
        ...flags.map((flag) => {
          const index = recipe.steps.findIndex((s) => s.id === flag.stepId);
          const where = index >= 0 ? `step ${index + 1}` : "a step";
          return {
            kind: "scale" as const,
            detail: `Check "${flag.token}" in ${where}; it was not rescaled.`,
          };
        }),
      ],
    },
    flags,
  };
}
