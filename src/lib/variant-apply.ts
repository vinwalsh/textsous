import type { ArtifactChange, CookAlongArtifact } from "./schema/artifact";
import { DIETARY_TARGETS, type VariantTransform } from "./schema/variant";
import { deriveMethod, rollUpAllergens } from "./stages/compile";
import { extractTimingNumbers } from "./scaling/amounts";

export interface ApplyVariantOptions {
  /**
   * Normalized ingredient names removed by earlier variants. A swap that
   * reintroduces one is refused, so an earlier dietary variant still holds.
   */
  forbiddenNames?: string[];
}

export interface ApplyVariantResult {
  artifact: CookAlongArtifact;
  /**
   * Normalized names removed so far, including this application. Thread into
   * later variants via forbiddenNames.
   */
  removedNames: string[];
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Apply a dietary or cuisine transform to an artifact. Pure: all model
 * judgment happened upstream; code swaps, overrides, recomputes and guards.
 * Refuses unknown references, timing changes in step overrides, and swaps
 * that reintroduce ingredients removed by an earlier variant. Swapped-in
 * ingredients carry empty allergen tags (unknown, never allergen-free); the
 * swap's packageRequirements tell the cook what to verify on the label.
 */
export function applyVariant(
  artifact: CookAlongArtifact,
  transform: VariantTransform,
  opts: ApplyVariantOptions = {},
): ApplyVariantResult {
  if (
    transform.kind === "dietary" &&
    !(DIETARY_TARGETS as readonly string[]).includes(transform.target)
  ) {
    throw new Error(`unknown dietary target "${transform.target}"`);
  }
  const forbidden = new Set(opts.forbiddenNames ?? []);
  const removedNames = new Set<string>(forbidden);
  const recipe = artifact.recipe;
  const byId = new Map(recipe.ingredients.map((i) => [i.id, i] as const));
  const changes: ArtifactChange[] = [];

  let ingredients = [...recipe.ingredients];
  for (const swap of transform.swaps) {
    const current = byId.get(swap.fromIngredientId);
    if (!current) {
      throw new Error(`swap references unknown ingredient "${swap.fromIngredientId}"`);
    }
    const oldName = current.name;
    removedNames.add(normalizeName(oldName));
    const to = swap.to ?? null;
    if (to === null) {
      ingredients = ingredients.filter((i) => i.id !== current.id);
      changes.push({
        kind: "swap",
        detail: `removed ${oldName} (${swap.omitReason ?? swap.reason})`,
      });
      continue;
    }
    if (forbidden.has(normalizeName(to.name))) {
      throw new Error(
        `refuses: ${to.name} reintroduces an ingredient removed by an earlier variant`,
      );
    }
    const verify =
      swap.packageRequirements.length > 0
        ? ` Verify on label: ${swap.packageRequirements.join("; ")}.`
        : "";
    // The id stays put so timeline references keep resolving; quantities are
    // the model's at the current scale.
    ingredients = ingredients.map((i) =>
      i.id === current.id
        ? {
            ...i,
            name: to.name,
            quantity: to.quantity,
            unit: to.unit,
            quantity4: null,
            scaleRule: null,
            cookQuantity: to.quantity,
            buyQuantity: to.quantity,
            allergens: [],
            allergenTraces: [],
            note: `Replaces ${oldName} (${transform.kind} ${transform.target}).${verify}`,
          }
        : i,
    );
    changes.push({
      kind: "swap",
      detail: `${oldName} → ${to.name} (${transform.target}): ${swap.reason}`,
    });
  }

  const stepById = new Map(recipe.steps.map((s) => [s.id, s] as const));
  let steps = [...recipe.steps];
  for (const override of transform.stepOverrides) {
    const current = stepById.get(override.stepId);
    if (!current) {
      throw new Error(`step override references unknown step "${override.stepId}"`);
    }
    if (!sameMultiset(extractTimingNumbers(current.text), extractTimingNumbers(override.text))) {
      throw new Error(`refuses: step override for ${override.stepId} changes timings`);
    }
    steps = steps.map((s) => (s.id === current.id ? { ...s, text: override.text } : s));
  }

  for (const technique of transform.techniqueChanges) {
    changes.push({ kind: "technique", detail: technique });
  }

  const { label: newLabel } = deriveMethod(steps);
  let methodLabel = recipe.methodLabel;
  let methodNotice = recipe.methodNotice;
  if (newLabel && recipe.methodLabel && newLabel !== recipe.methodLabel) {
    methodLabel = newLabel;
    methodNotice =
      `Method changed from ${recipe.methodLabel} to ${newLabel} ` +
      `(${transform.kind} ${transform.target})`;
  } else if (newLabel && !recipe.methodLabel) {
    methodLabel = newLabel;
  }

  return {
    artifact: {
      ...artifact,
      recipe: {
        ...recipe,
        title: transform.titleOverride ?? recipe.title,
        ingredients,
        steps,
        allergens: rollUpAllergens({ ingredients }),
        methodLabel,
        methodNotice,
      },
      changes: [...artifact.changes, ...changes],
    },
    removedNames: [...removedNames],
  };
}
