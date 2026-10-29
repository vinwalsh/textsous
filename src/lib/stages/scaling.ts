import { z } from "zod";
import { ScaleRuleSchema } from "../schema/canonical";
import type { CookAlongArtifact } from "../schema/artifact";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { findNumbers, parseAmount } from "../scaling/amounts";
import { effectiveFactor, formatAmount, round2, scaleIngredient } from "../scaling/scale";

export const SCALING_VERSION = 1;
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

interface MappedValue {
  scaled: number;
  unit: string;
  name: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unit matches as a whole word, tolerating a plural s ("cup" in "2 cups"). */
function unitMentioned(stepLower: string, unit: string): boolean {
  if (!unit) return false;
  return new RegExp(`\\b${escapeRegExp(unit.toLowerCase())}s?\\b`).test(stepLower);
}

function rescaleStepText(
  stepId: string,
  text: string,
  candidatesOf: (value: number) => MappedValue[],
): { text: string; flags: ScaleFlag[] } {
  const found = findNumbers(text);
  const flags: ScaleFlag[] = [];
  let out = text;
  const lowered = text.toLowerCase();
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const token = found[i];
    const match =
      token.value === null
        ? undefined
        : candidatesOf(token.value).find(
            (c) => unitMentioned(lowered, c.unit) || lowered.includes(c.name.toLowerCase()),
          );
    if (token.value === null || match === undefined) {
      flags.push({ stepId, token: token.token });
      continue;
    }
    out = `${out.slice(0, token.start)}${formatAmount(match.scaled)}${out.slice(token.end)}`;
  }
  return { text: out, flags: flags.reverse() };
}

/**
 * Rescale an artifact to a target servings count. Servings must stay within
 * 0.5-12. Step numbers matching a scaled ingredient quantity (with its unit
 * or name in the step) are rescaled; every other number is flagged for the
 * cook to verify. Pure.
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
  const factor = targetServings / recipe.servings;
  const byId = new Map(rules.map((r) => [r.ingredientId, r.rule] as const));
  const missing = recipe.ingredients.map((i) => i.id).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`missing scale rule for ${missing.join(", ")}`);
  }
  const candidatesOf = new Map<number, MappedValue[]>();
  const ingredients = recipe.ingredients.map((ingredient) => {
    const rule = byId.get(ingredient.id) ?? "linear";
    const scaled = scaleIngredient({ ...ingredient, scaleRule: rule }, factor);
    const parsed = parseAmount(ingredient.quantity);
    if (parsed !== null) {
      const eff = effectiveFactor(rule, factor);
      for (const end of parsed.low === parsed.high ? [parsed.low] : [parsed.low, parsed.high]) {
        const list = candidatesOf.get(end) ?? [];
        list.push({
          scaled: round2(end * eff),
          unit: ingredient.unit,
          name: ingredient.name,
        });
        candidatesOf.set(end, list);
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
    const rescaled = rescaleStepText(step.id, step.text, (value) => candidatesOf.get(value) ?? []);
    flags.push(...rescaled.flags);
    return { ...step, text: rescaled.text };
  });
  return {
    artifact: {
      ...artifact,
      recipe: { ...recipe, servings: targetServings, ingredients, steps },
      changes: [
        ...artifact.changes,
        {
          kind: "scale" as const,
          detail: `rescaled ${recipe.servings} → ${targetServings} servings (×${formatAmount(factor)})`,
        },
        ...flags.map((flag) => ({
          kind: "scale" as const,
          detail: `verify "${flag.token}" in step ${flag.stepId} (not rescaled)`,
        })),
      ],
    },
    flags,
  };
}
