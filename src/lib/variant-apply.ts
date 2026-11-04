import type { ArtifactChange, CookAlongArtifact } from "./schema/artifact";
import { DIETARY_TARGETS, type VariantTransform } from "./schema/variant";
import { deriveMethod, rollUpAllergens } from "./stages/compile";
import { extractTimingNumbers, parseAmount } from "./scaling/amounts";
import { formatKitchenAmount } from "./scaling/scale";
import { nativeServingsOf } from "./scaling/native";
import { applyAllergenFloor } from "./allergens";
import type { TimelineTask } from "./schema/timeline";
import { mentions, mentionsAny, rewordForSwaps, uniqueHeads, type TextSwap } from "./variant-text";

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
  /**
   * Readable notes about automatic fixes: task or step text reworded in code
   * because the model gave no usable override. Also listed in changes.
   */
  warnings: string[];
}

/** Step-card text sent to the dietary and cuisine prompts. */
export interface VariantTaskText {
  id: string;
  label: string;
  description: string;
  completionCue: string;
  checkpoints: string[];
}

export function taskTextOf(artifact: CookAlongArtifact): VariantTaskText[] {
  return artifact.timelineDefinition.tasks.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    completionCue: t.completionCue,
    checkpoints: [...t.checkpoints],
  }));
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The model returns swapped amounts at the current servings. Ingredient
 * quantities stay at native servings (scaling always starts there), so a
 * swapped amount is scaled back; cookQuantity keeps the model's amount.
 */
function toNativeQuantity(quantity: string, currentFactor: number): string {
  if (Math.abs(currentFactor - 1) < 1e-9) return quantity;
  const parsed = parseAmount(quantity);
  if (parsed === null) return quantity;
  const low = formatKitchenAmount(parsed.low / currentFactor);
  const high = formatKitchenAmount(parsed.high / currentFactor);
  return parsed.low === parsed.high ? low : `${low}-${high}`;
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
 * ingredients start with empty allergen tags (unknown, never allergen-free)
 * and get only the deterministic floor (almond milk -> nuts); the swap's
 * packageRequirements tell the cook what to verify on the label.
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
  const warnings: string[] = [];
  const currentFactor = recipe.servings / nativeServingsOf(recipe, artifact.changes);
  const heads = uniqueHeads(recipe.ingredients.map((i) => i.name));
  const textSwaps: TextSwap[] = [];

  let ingredients = [...recipe.ingredients];
  for (const swap of transform.swaps) {
    const current = byId.get(swap.fromIngredientId);
    if (!current) {
      throw new Error(`swap references unknown ingredient "${swap.fromIngredientId}"`);
    }
    const oldName = current.name;
    removedNames.add(normalizeName(oldName));
    const to = swap.to ?? null;
    textSwaps.push({ oldName, newName: to?.name ?? null, head: heads.get(oldName) ?? null });
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
            quantity: toNativeQuantity(to.quantity, currentFactor),
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

  // Substitute names are protected from rewording ("vegan butter" stays).
  const protectedNames = transform.swaps
    .map((swap) => swap.to?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  const overriddenSteps = new Set(transform.stepOverrides.map((o) => o.stepId));
  steps = steps.map((step, index) => {
    if (!mentionsAny(step.text, textSwaps, protectedNames)) return step;
    const text = rewordForSwaps(step.text, textSwaps, protectedNames);
    const note = overriddenSteps.has(step.id)
      ? `Step ${index + 1} still named a swapped ingredient after the rewrite, so it was reworded automatically.`
      : `Step ${index + 1} was reworded automatically for the swap; check the amounts.`;
    warnings.push(note);
    return { ...step, text: text || step.text };
  });

  const tasks = applyTaskOverrides(
    artifact.timelineDefinition.tasks,
    transform,
    textSwaps,
    protectedNames,
    [...forbidden],
    warnings,
  );
  for (const warning of warnings) changes.push({ kind: "swap", detail: warning });

  ingredients = applyAllergenFloor(ingredients);

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
      timelineDefinition: { ...artifact.timelineDefinition, tasks },
      changes: [...artifact.changes, ...changes],
    },
    removedNames: [...removedNames],
    warnings,
  };
}

const TASK_FIELDS = ["label", "description", "completionCue"] as const;

function timingsOf(task: Pick<TimelineTask, "label" | "description" | "completionCue" | "checkpoints">): number[] {
  return extractTimingNumbers(
    [task.label, task.description, task.completionCue, ...task.checkpoints].join(" \n "),
  );
}

/**
 * Bring step-card text in line with the swaps. Model taskOverrides apply
 * first, under the same guards as step overrides: timing numbers unchanged
 * and no removed ingredient named again (a failing override is dropped with
 * a warning). Any card text that still names a swapped ingredient is then
 * reworded in code: the substitute's name replaces the old one, or the
 * clause goes for a removal. Timings, ids and structure never change.
 */
function applyTaskOverrides(
  tasks: TimelineTask[],
  transform: VariantTransform,
  swaps: TextSwap[],
  protectedNames: string[],
  earlierRemoved: string[],
  warnings: string[],
): TimelineTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const overrides = new Map<string, NonNullable<VariantTransform["taskOverrides"]>[number]>();
  for (const override of transform.taskOverrides ?? []) {
    if (!byId.has(override.taskId)) {
      warnings.push("A suggested rewrite for a step card that does not exist was ignored.");
      continue;
    }
    overrides.set(override.taskId, override);
  }
  // Earlier variants' removals are guarded by full name only.
  const earlierSwaps: TextSwap[] = earlierRemoved.map((name) => ({
    oldName: name,
    newName: null,
    head: null,
  }));
  const guardSwaps = [...swaps, ...earlierSwaps];

  return tasks.map((task) => {
    let next: TimelineTask = task;
    const override = overrides.get(task.id);
    if (override) {
      const candidate: TimelineTask = {
        ...task,
        label: override.label ?? task.label,
        description: override.description ?? task.description,
        completionCue: override.completionCue ?? task.completionCue,
        checkpoints: override.checkpoints ?? task.checkpoints,
      };
      const texts = [
        candidate.label,
        candidate.description,
        candidate.completionCue,
        ...candidate.checkpoints,
      ];
      if (!sameMultiset(timingsOf(task), timingsOf(candidate))) {
        warnings.push(
          `The rewrite for "${task.label}" changed a timing, so the original wording was kept.`,
        );
      } else if (texts.some((t) => mentionsAny(t, guardSwaps, protectedNames))) {
        warnings.push(
          `The rewrite for "${task.label}" named a removed ingredient, so it was reworded automatically.`,
        );
      } else {
        next = candidate;
      }
    }
    const reword = (text: string): string => rewordForSwaps(text, swaps, protectedNames);
    const stillNamed =
      TASK_FIELDS.some((f) => mentionsAny(next[f], swaps, protectedNames)) ||
      next.checkpoints.some((c) => mentionsAny(c, swaps, protectedNames)) ||
      mentionsAny(next.cardTitle.subject, swaps, protectedNames) ||
      mentionsAny(next.cardTitle.context, swaps, protectedNames) ||
      (typeof next.tip === "string" && mentionsAny(next.tip, swaps, protectedNames)) ||
      (typeof next.why === "string" && mentionsAny(next.why, swaps, protectedNames));
    if (!stillNamed) return next;
    const removedOnly = swaps.filter((s) => s.newName === null).map((s) => s.oldName);
    const fallbackDescription =
      removedOnly.length > 0 ? `Skip the ${removedOnly.join(" and ")} for this version.` : next.description;
    const rewritten: TimelineTask = {
      ...next,
      label: reword(next.label) || next.label,
      cardTitle: {
        ...next.cardTitle,
        subject: reword(next.cardTitle.subject) || "step",
        context: reword(next.cardTitle.context),
      },
      description: reword(next.description) || fallbackDescription,
      completionCue: reword(next.completionCue) || "Done.",
      checkpoints: next.checkpoints.map(reword).filter((c) => c.length > 0),
      tip: typeof next.tip === "string" ? reword(next.tip) || null : next.tip,
      why: typeof next.why === "string" ? reword(next.why) || null : next.why,
    };
    const named = swaps
      .filter((swap) =>
        [next.label, next.description, next.completionCue, ...next.checkpoints, next.cardTitle.subject, next.cardTitle.context, next.tip ?? "", next.why ?? ""].some(
          (t) => mentions(t, swap, protectedNames),
        ),
      )
      .map((swap) =>
        swap.newName === null ? `removed ${swap.oldName}` : `${swap.oldName} → ${swap.newName}`,
      );
    warnings.push(
      `"${task.label}" was reworded automatically (${named.join(", ")}); check the amounts.`,
    );
    return rewritten;
  });
}
