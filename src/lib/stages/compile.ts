import { createHash } from "node:crypto";
import type { CanonicalRecipe } from "../schema/canonical";
import {
  CookAlongArtifactSchema,
  type ArtifactChange,
  type CookAlongArtifact,
  type EquipmentProfile,
} from "../schema/artifact";
import type { TimelineDefinition } from "../schema/timeline";
import type { ReviewResult } from "./review";

export const COMPILE_VERSION = 1;

export interface CompileInput {
  recipe: CanonicalRecipe;
  timeline: TimelineDefinition;
  review: ReviewResult;
  equipmentProfile: EquipmentProfile;
}

const METHOD_TABLE: Array<{ pattern: RegExp; method: string; label: string }> = [
  { pattern: /bak(e|ed|ing)\b/, method: "bake", label: "Baked" },
  { pattern: /roast/, method: "roast", label: "Roasted" },
  { pattern: /grill|char/, method: "grill", label: "Grilled" },
  { pattern: /fry|fried|saut|sear/, method: "fry", label: "Fried" },
  { pattern: /simmer/, method: "simmer", label: "Simmered" },
  { pattern: /boil/, method: "boil", label: "Boiled" },
  { pattern: /steam/, method: "steam", label: "Steamed" },
  { pattern: /poach/, method: "poach", label: "Poached" },
  { pattern: /toast/, method: "toast", label: "Toasted" },
];

/**
 * Primary cooking method from the step text: first table match in step order,
 * empty when no heat method is named. Deterministic and transparent; dietary
 * and cuisine stages compare against it to fill methodNotice.
 */
export function deriveMethod(steps: Array<{ text: string }>): { method: string; label: string } {
  for (const step of steps) {
    const text = step.text.toLowerCase();
    for (const entry of METHOD_TABLE) {
      if (entry.pattern.test(text)) return { method: entry.method, label: entry.label };
    }
  }
  return { method: "", label: "" };
}

/** Union of declared allergens across ingredients, sorted. Traces stay visible
 * per ingredient; the roll-up lists definite presence only. */
export function rollUpAllergens<T extends string>(recipe: {
  ingredients: Array<{ allergens: T[] }>;
}): T[] {
  const rolled = new Set<T>();
  for (const ingredient of recipe.ingredients) {
    for (const allergen of ingredient.allergens) rolled.add(allergen);
  }
  return [...rolled].sort();
}

function listChanges(timeline: TimelineDefinition): ArtifactChange[] {
  const changes: ArtifactChange[] = [];
  for (const task of timeline.tasks) {
    if (task.sourceStepIds.length > 1) {
      changes.push({
        kind: "merged-steps",
        detail: `${task.id} merges ${task.sourceStepIds.join(", ")}`,
      });
    }
    if (task.timingBasis === "estimate") {
      changes.push({ kind: "estimate", detail: `${task.id} timing is estimated` });
    }
  }
  return changes;
}

/**
 * Assemble the validated Cook Along artifact. Pure and synchronous: no model
 * calls. Refuses to compile when review failed, with the readable reasons.
 * methodNotice is always empty here; variant stages fill it when they change
 * the method.
 */
export function compile(input: CompileInput): CookAlongArtifact {
  if (!input.review.passed) {
    throw new Error(`compile blocked: ${input.review.blockers.join("; ") || "review failed"}`);
  }
  const { recipe, timeline, equipmentProfile } = input;
  const { method, label } = deriveMethod(recipe.steps);
  const id = `art-${createHash("sha256")
    .update(`${recipe.sourceFingerprint}:${JSON.stringify(timeline)}`)
    .digest("hex")
    .slice(0, 12)}`;
  return CookAlongArtifactSchema.parse({
    formatVersion: 1,
    id,
    recipe: {
      title: recipe.title,
      servings: recipe.nativeServings,
      ingredients: recipe.ingredients,
      equipment: recipe.equipment,
      steps: recipe.steps,
      allergens: rollUpAllergens(recipe),
      originalMethod: method,
      methodLabel: label,
      methodNotice: "",
      credit: {
        kind: recipe.source.kind,
        site: recipe.source.site ?? null,
        author: recipe.source.author ?? null,
        url: recipe.source.url ?? null,
        book: recipe.source.book ?? null,
        page: recipe.source.page ?? null,
        license: recipe.source.license ?? null,
      },
    },
    timelineDefinition: timeline,
    equipmentProfile,
    changes: listChanges(timeline),
  });
}
