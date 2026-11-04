import { recipeDisplayIdentity } from "./recipe-view";

export interface EffectiveCookingInstruction {
  id: string;
  kind: string;
  text: string;
  /** Explicit references into the selected source; never positional matching. */
  sourceStepIds: readonly string[];
  dependsOn: {
    servings: boolean;
    ingredientIds: readonly string[];
    equipmentIds: readonly string[];
    /** A changed dietary method invalidates this instruction, even if names match. */
    dietaryMethod: boolean;
  };
}

export interface EffectiveCookingIdentityInput {
  sourceFingerprint: string;
  variant: null | { id: string; revision: string; sourceFingerprint: string };
  servings: number;
  profileId: string;
  ingredients: readonly unknown[];
  method: readonly unknown[];
  resources: readonly unknown[];
}

/** Canonical JSON of cooking facts. Reject unsupported values instead of silently omitting them. */
export function canonicalCookingJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCookingJson).join(",")}]`;
  if (typeof value === "object" && value !== null
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalCookingJson(item)}`).join(",")}}`;
  }
  throw new Error("Cooking identity requires finite JSON facts");
}

/** Browser-local equality only. This is not a source hash, review, or authorization. */
export function cookingContentIdentity(value: unknown): string {
  return recipeDisplayIdentity(JSON.parse(canonicalCookingJson(value)));
}

/** Bind progress/preview to the complete effective recipe, not just its ingredient labels. */
export function effectiveCookingIdentity(input: EffectiveCookingIdentityInput): string {
  if (!/^[a-f0-9]{64}$/.test(input.sourceFingerprint) || !Number.isFinite(input.servings)
    || input.servings <= 0 || !input.profileId.trim()
    || !Array.isArray(input.ingredients) || !Array.isArray(input.method) || !input.method.length
    || !Array.isArray(input.resources)
    || (input.variant !== null && (!input.variant.id || !input.variant.revision || !/^[a-f0-9]{64}$/.test(input.variant.sourceFingerprint)))) {
    throw new Error("A complete effective recipe identity is required");
  }
  return `effective-${cookingContentIdentity({ version: 1, ...input })}`;
}

/** A method may be reused only for the same complete source/selection/method/resource facts. */
export function canReuseEffectiveMethod(before: EffectiveCookingIdentityInput, after: EffectiveCookingIdentityInput): boolean {
  return effectiveCookingIdentity(before) === effectiveCookingIdentity(after);
}
