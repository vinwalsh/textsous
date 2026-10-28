import { createHash } from "node:crypto";
import {
  CANONICAL_SCHEMA_NAME,
  CanonicalRecipeSchema,
  EU14_ALLERGENS,
  type CanonicalRecipe,
} from "../schema/canonical";
import { fingerprintSource } from "../intake/fingerprint";
import { callStructured, type ProviderName, type TokenUsage } from "../model";

export const CANONICALIZE_VERSION = 1;

export interface CanonicalizeInput {
  source: { kind: "url" | "text"; url?: string; site?: string; author?: string };
  title?: string;
  ingredientLines: string[];
  instructionLines: string[];
  servingsRaw?: string;
  rawText: string;
  hasJsonLd: boolean;
}

export type CanonicalizeCheckName = "ingredient_count" | "servings" | "ingredient_names";

export interface CanonicalizeCheck {
  name: CanonicalizeCheckName;
  passed: boolean;
  detail: string;
}

export interface CanonicalizeResult {
  recipe: CanonicalRecipe;
  checks: CanonicalizeCheck[];
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
  /** Verbatim successful model completion (for --record). */
  rawResponse: string;
}

/** Format of eval/recordings/*.json, written by `convert --record`. */
export interface RecordingFile {
  version: 1;
  fixture: string;
  provider: ProviderName;
  model: string;
  recordedAt: string;
  usage: TokenUsage;
  input: CanonicalizeInput;
  /** Verbatim successful model completion. */
  response: string;
}

export interface ParsedServings {
  low: number;
  high?: number;
}

/** Parse "2", "2 servings", "4-6", "Makes about 12" -> { low, high? }. */
export function parseServings(raw: string): ParsedServings | null {
  const match = raw
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(?:[-–—]|to\s+)?\s*(\d+(?:\.\d+)?)?/);
  if (!match) return null;
  const low = Number(match[1]);
  const high = match[2] !== undefined ? Number(match[2]) : undefined;
  if (!Number.isFinite(low) || low <= 0) return null;
  if (high !== undefined && (!Number.isFinite(high) || high <= 0)) return null;
  return { low, high };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SECTION_PREFIX_RE = /^\[([^\]]+)\]\s*/;

/** Section labels the extractor injected into instruction lines. Pure. */
export function injectedSectionLabels(instructionLines: string[]): string[] {
  const labels = new Set<string>();
  for (const line of instructionLines) {
    const match = SECTION_PREFIX_RE.exec(line);
    if (match) labels.add(match[1]);
  }
  return [...labels];
}

/**
 * Remove leading [Section] labels the extractor injected. Only strips labels
 * in `labels`, so genuine source brackets are never touched. Pure.
 */
export function stripInjectedSectionLabels(text: string, labels: string[]): string {
  let cleaned = text;
  for (;;) {
    const match = SECTION_PREFIX_RE.exec(cleaned);
    if (!match || !labels.includes(match[1])) return cleaned;
    cleaned = cleaned.slice(match[0].length);
  }
}

/**
 * Deterministic checks of the model output against the extracted source.
 * Pure: no model calls, safe for offline tests.
 */
export function runCanonicalChecks(
  input: CanonicalizeInput,
  recipe: CanonicalRecipe,
): CanonicalizeCheck[] {
  const checks: CanonicalizeCheck[] = [];

  if (!input.hasJsonLd || input.ingredientLines.length === 0) {
    checks.push({
      name: "ingredient_count",
      passed: true,
      detail: "skipped: no JSON-LD ingredient list",
    });
  } else if (recipe.ingredients.length === input.ingredientLines.length) {
    checks.push({
      name: "ingredient_count",
      passed: true,
      detail: `${recipe.ingredients.length} ingredients match the source list`,
    });
  } else {
    checks.push({
      name: "ingredient_count",
      passed: false,
      detail: `recipe has ${recipe.ingredients.length} ingredients but the source lists ${input.ingredientLines.length}`,
    });
  }

  const parsed = input.servingsRaw ? parseServings(input.servingsRaw) : null;
  if (!input.servingsRaw || !parsed) {
    checks.push({ name: "servings", passed: true, detail: "skipped: no parseable servings" });
  } else {
    const candidates = parsed.high === undefined ? [parsed.low] : [parsed.low, parsed.high];
    const nativeOk = candidates.includes(recipe.nativeServings);
    const largeOk =
      recipe.servingsLarge === null ||
      recipe.servingsLarge === undefined ||
      candidates.includes(recipe.servingsLarge);
    checks.push({
      name: "servings",
      passed: nativeOk && largeOk,
      detail: nativeOk && largeOk
        ? `nativeServings=${recipe.nativeServings} matches "${input.servingsRaw}"`
        : `nativeServings=${recipe.nativeServings} does not match "${input.servingsRaw}"`,
    });
  }

  const pool =
    input.hasJsonLd && input.ingredientLines.length > 0
      ? input.ingredientLines.join("\n").toLowerCase()
      : input.rawText.toLowerCase();
  const missing = recipe.ingredients
    .map((ing) => ing.name)
    .filter((name) => {
      const normalized = normalizeName(name);
      if (!normalized) return true;
      if (pool.includes(name.toLowerCase())) return false;
      if (pool.includes(normalized)) return false;
      const singular = normalized.replace(/s\b/g, "");
      return !pool.includes(singular);
    });
  checks.push({
    name: "ingredient_names",
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? "every ingredient name appears in the source"
        : `not found in source: ${missing.join("; ")}`,
  });

  return checks;
}

const SYSTEM_PROMPT = `You convert a recipe into the TextSous canonical recipe JSON. Rules:
- Transcribe faithfully: never invent ingredients, quantities, timings, equipment, or steps.
- Keep quantities exactly as printed, as free text (e.g. "1 1/2"). Leave quantity empty only when the source gives no amount.
- Split steps into prep (mise en place only: washing, chopping, measuring) and active (ordered cooking steps).
- Tag each ingredient with EU-14 allergen codes you are certain apply from the name alone (${EU14_ALLERGENS.join(", ")}). When uncertain, leave allergens empty: missing means unknown.
- Set scaleRule to "to-taste" for season-to-taste items, otherwise leave it null.
- Leave cuisine and scalingNotes empty unless the source states them.
- List every piece of equipment the source names (pans, grill, bowls, tools) in the source's own words; leave equipment empty only if the source names none.
- Instruction lines may begin with [Section] labels from the source layout; use them as context but never copy bracketed labels into step text.
- Use temporary ids ("ing-1", "step-1", ...); they are replaced by code.
Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(input: CanonicalizeInput): string {
  if (input.hasJsonLd && input.ingredientLines.length > 0) {
    return JSON.stringify({
      title: input.title ?? null,
      servingsRaw: input.servingsRaw ?? null,
      ingredientLines: input.ingredientLines,
      instructionLines: input.instructionLines,
    });
  }
  const text =
    input.rawText.length > 8000 ? `${input.rawText.slice(0, 8000)}\n[truncated]` : input.rawText;
  return JSON.stringify({
    title: input.title ?? null,
    recipeText: text,
  });
}

/**
 * One structured call turning extracted source into the canonical recipe,
 * then deterministic checks against the source. Code overwrites ids, source
 * credit, and the fingerprint so the model cannot invent them.
 */
export async function canonicalize(
  input: CanonicalizeInput,
  opts: { provider?: ProviderName } = {},
): Promise<CanonicalizeResult> {
  const result = await callStructured(
    CanonicalRecipeSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    { provider: opts.provider, schemaName: CANONICAL_SCHEMA_NAME },
  );

  const fingerprint = fingerprintSource([
    input.title ?? "",
    input.servingsRaw ?? "",
    ...input.ingredientLines,
    ...input.instructionLines,
    input.hasJsonLd ? "" : input.rawText.slice(0, 4000),
  ]);
  const recipeId = `rcp-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`;
  const sectionLabels = injectedSectionLabels(input.instructionLines);

  const recipe: CanonicalRecipe = {
    ...result.data,
    id: recipeId,
    source: {
      kind: input.source.kind,
      url: input.source.url ?? null,
      site: input.source.site ?? null,
      author: input.source.author ?? null,
      book: null,
      page: null,
      license: null,
    },
    sourceFingerprint: fingerprint,
    ingredients: result.data.ingredients.map((ing, i) => ({ ...ing, id: `ing-${i + 1}` })),
    steps: result.data.steps.map((step, i) => ({
      ...step,
      id: `step-${i + 1}`,
      text: stripInjectedSectionLabels(step.text, sectionLabels),
    })),
  };

  return {
    recipe,
    checks: runCanonicalChecks(input, recipe),
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
    rawResponse: result.rawContent,
  };
}
