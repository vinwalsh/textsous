import { z } from "zod";
import { ScaleRuleSchema } from "../schema/canonical";
import type { CookAlongArtifact } from "../schema/artifact";
import {
  callStructured,
  effortFor,
  type EffortOverrides,
  type ProviderName,
  type ReasoningEffort,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { effectiveFactor, formatAmount, round2, scalableAmount, scaleIngredient } from "../scaling/scale";
import { nativeServingsOf } from "../scaling/native";
import { MAX_SERVINGS, MIN_SERVINGS, servingsInRange } from "../scaling/servings";
import { rescaleText, type AmountMapping } from "../scaling/text";

export const SCALING_VERSION = 3;
export { MAX_SERVINGS, MIN_SERVINGS };

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
- sublinear: strong flavors in savory cooking that grow slower than servings (spices, chili, salt that cooks in).
- flat: amounts independent of servings (oil for the pan, water for boiling).
- superlinear: amounts that grow faster than servings (large-batch cooking liquid).
- to-taste: seasoned at the table (salt and pepper to taste, garnishes to liking).
Baked goods (muffins, cakes, breads, cookies, pastry) keep their ratios: every ingredient in a batter or dough is linear, leaveners and salt included.
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
  opts: {
    provider?: ProviderName;
    client?: StructuredChatClient;
    /** Wins over efforts and the env/code default (effortFor("scaling")). */
    reasoningEffort?: ReasoningEffort;
    efforts?: EffortOverrides;
  } = {},
): Promise<AssignedRules> {
  const result = await callStructured(
    ScaleRulesSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(recipe) },
    ],
    {
      provider: opts.provider,
      schemaName: SCALING_SCHEMA_NAME,
      client: opts.client,
      reasoningEffort: opts.reasoningEffort ?? effortFor("scaling", opts.efforts),
    },
  );
  return {
    rules: result.data.rules,
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
  };
}

export interface ScaleFlag {
  /** Recipe step the token is in; for a step card, the card's first source step. */
  stepId: string;
  token: string;
  /** Set when the token is in step-card text: the card's label. */
  card?: string;
}

export interface ApplyScalingResult {
  artifact: CookAlongArtifact;
  flags: ScaleFlag[];
  /** Names of ingredients whose amounts could not be rescaled ("Half a" red onion). */
  unscaled: string[];
}

/** Amounts nobody needs to check: nothing printed, or not a measured amount. */
const NOTHING_TO_CHECK = /^\s*$|\b(?:to taste|as needed|as desired|optional)\b/i;

/** The reader's note for ingredients left as printed. Pure. */
export function unscaledNote(names: readonly string[]): string {
  return `Check these amounts; they were not rescaled: ${names.join(", ")}.`;
}

/**
 * Rescale an artifact to a target servings count. Servings must stay within
 * 0.5-36. Amounts always scale from the printed quantity at nativeServings
 * (factor = target / nativeServings), so 2 -> 4 -> 6 equals 2 -> 6. Numbers
 * in step and task text that read as an ingredient's current amount (the
 * number directly followed by its unit or name) are rescaled; times,
 * temperatures and pan sizes never are. Other amount-like numbers in steps
 * and step cards are flagged for the cook to verify. Ingredients whose
 * amounts cannot be rescaled ("Half a", "A fistful") stay as printed and are
 * named in `unscaled` and in one change note. Pure.
 */
export function applyScaling(
  artifact: CookAlongArtifact,
  targetServings: number,
  rules: ScaleRuleAssignment[],
): ApplyScalingResult {
  if (!servingsInRange(targetServings)) {
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
  const unscaled: string[] = [];
  const ingredients = recipe.ingredients.map((ingredient) => {
    const rule = byId.get(ingredient.id) ?? "linear";
    const scaled = scaleIngredient({ ...ingredient, scaleRule: rule }, factor);
    const eff = effectiveFactor(rule, factor);
    // The leading amount when the quantity is more than one ("1/2 cup (100g)").
    const original = scalableAmount(ingredient.quantity, ingredient.unit);
    const current = scalableAmount(ingredient.cookQuantity ?? ingredient.quantity, ingredient.unit);
    if (scaled.scaled && original !== null && current !== null) {
      const ends: Array<[number, number]> =
        original.amount.low === original.amount.high
          ? [[current.amount.low, original.amount.low]]
          : [
              [current.amount.low, original.amount.low],
              [current.amount.high, original.amount.high],
            ];
      for (const [now, base] of ends) {
        mappings.push({
          current: now,
          next: round2(base * eff),
          unit: original.unit,
          name: ingredient.name,
        });
      }
    } else if (
      !scaled.scaled &&
      rule !== "to-taste" &&
      Math.abs(eff - 1) > 1e-9 &&
      !NOTHING_TO_CHECK.test(ingredient.quantity) &&
      !unscaled.includes(ingredient.name)
    ) {
      unscaled.push(ingredient.name);
    }
    return {
      ...ingredient,
      scaleRule: rule,
      cookQuantity: scaled.cook.quantity,
      buyQuantity: scaled.buy.quantity,
    };
  });
  const names = recipe.ingredients.map((i) => i.name);
  const flags: ScaleFlag[] = [];
  const steps = recipe.steps.map((step) => {
    const rescaled = rescaleText(step.text, mappings, names);
    flags.push(...rescaled.unmatched.map((token) => ({ stepId: step.id, token })));
    return { ...step, text: rescaled.text };
  });
  // Step cards render task text, so amounts there scale too. The cook
  // follows the cards, so anything left unscaled there is flagged as well.
  const cardFlags: ScaleFlag[] = [];
  const tasks = artifact.timelineDefinition.tasks.map((task) => {
    const unmatched = new Set<string>();
    const rescale = (text: string): string => {
      const rescaled = rescaleText(text, mappings, names);
      for (const token of rescaled.unmatched) unmatched.add(token);
      return rescaled.text;
    };
    const next = {
      ...task,
      label: rescale(task.label),
      description: rescale(task.description),
      completionCue: rescale(task.completionCue),
      checkpoints: task.checkpoints.map(rescale),
    };
    for (const token of unmatched) {
      cardFlags.push({ stepId: task.sourceStepIds[0] ?? "", token, card: next.label });
    }
    return next;
  });
  flags.push(...cardFlags);
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
        ...(unscaled.length > 0 ? [{ kind: "scale" as const, detail: unscaledNote(unscaled) }] : []),
        ...flags.map((flag) => {
          const index = recipe.steps.findIndex((s) => s.id === flag.stepId);
          const where = flag.card
            ? `the "${flag.card}" card`
            : index >= 0
              ? `step ${index + 1}`
              : "a step";
          return {
            kind: "scale" as const,
            detail: `Check "${flag.token}" in ${where}; it was not rescaled.`,
          };
        }),
      ],
    },
    flags,
    unscaled,
  };
}
