import { EU14_ALLERGENS, type CanonicalRecipe, type Eu14Allergen } from "./schema/canonical";
import type { CookAlongArtifact } from "./schema/artifact";
import type { TimelineDefinition } from "./schema/timeline";
import type { RecipeJsonLd } from "./intake/url";
import { inferAllergens, rollUpTraces } from "./allergens";

/**
 * Progressive conversion (M8). A client that sends
 * `Accept: application/x-ndjson` to POST /api/convert gets status 200 and one
 * JSON event per line as each part of the conversion is ready, in this order:
 *
 *   facts -> overview -> recipe -> procedure -> done
 *
 * Any event but the last may be skipped (a cache hit sends only `done`), and
 * `facts` may come again with `recipe` once the recipe is read. A failure
 * after the stream starts ends it with one `error` event carrying the status
 * the JSON route would have answered. Failures found before the stream
 * starts (bad input, a refused page, limits) keep their usual JSON answers
 * and status codes. Clients that do not ask for NDJSON get the JSON answer,
 * unchanged. Client-safe: no Node APIs.
 */
export const CONVERT_EVENTS_MEDIA_TYPE = "application/x-ndjson";

export type SourceKind = CanonicalRecipe["source"]["kind"];

/** What a reader can know about a recipe before its cook along is ready. */
export interface RecipeFacts {
  title: string | null;
  source: { kind: SourceKind; url: string | null; site: string | null; author: string | null };
  /** Servings or yield as the source posts it, e.g. "12 muffins" or "4". */
  servingsText: string | null;
  ingredientCount: number | null;
  /** Times the source posts, in minutes; null when it posts none. */
  minutes: { prep: number | null; cook: number | null; total: number | null };
  /** EU-14 allergens found so far (definite), in EU-14 order. */
  allergens: Eu14Allergen[];
  /** "May contain" allergens, never repeating a definite one. */
  traces: Eu14Allergen[];
}

/** A quick read of the recipe from a fast model call, before the cook along. */
export interface RecipeOverview {
  /** One or two calm sentences on what the cook will do. */
  summary: string;
  /** The recipe's components and how each is prepared, in cooking order. */
  components: { name: string; how: string }[];
}

export type ConvertEvent =
  | { type: "facts"; facts: RecipeFacts }
  | { type: "overview"; overview: RecipeOverview }
  | { type: "recipe"; recipe: CanonicalRecipe; facts: RecipeFacts }
  /** Tasks (prep, steps, tips) before the review has checked them. */
  | { type: "procedure"; timeline: TimelineDefinition }
  | { type: "done"; artifact: CookAlongArtifact; cached: boolean; warnings: string[] }
  | { type: "error"; status: number; error: string; reason?: string };

export type ConvertEventType = ConvertEvent["type"];

/** One NDJSON line. */
export function encodeEvent(event: ConvertEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Read NDJSON events from a response body as they arrive. Lines may be split
 * across chunks; blank lines are skipped; a line that is not a JSON object
 * with a string `type` throws.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ConvertEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield parseEventLine(line);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    const rest = buffer.trim();
    if (rest) yield parseEventLine(rest);
  } finally {
    reader.releaseLock();
  }
}

function parseEventLine(line: string): ConvertEvent {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    throw new Error("Not a conversion event.");
  }
  return value as ConvertEvent;
}

const ISO_DURATION = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/** ISO 8601 duration ("PT1H30M", "P0DT45M") to whole minutes; null if absent, zero or unreadable. */
export function parseIsoMinutes(value: string | null | undefined): number | null {
  const match = ISO_DURATION.exec((value ?? "").trim());
  if (!match || match[0] === "P" || match[0].toUpperCase() === "PT") return null;
  const [, d, h, m, s] = match;
  const minutes =
    Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60;
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function inEu14Order(set: Set<Eu14Allergen>): Eu14Allergen[] {
  return EU14_ALLERGENS.filter((a) => set.has(a));
}

function allergensOfLines(lines: readonly string[]): Pick<RecipeFacts, "allergens" | "traces"> {
  const definite = new Set<Eu14Allergen>();
  const traces = new Set<Eu14Allergen>();
  for (const line of lines) {
    const found = inferAllergens(line);
    found.allergens.forEach((a) => definite.add(a));
    found.traces.forEach((a) => traces.add(a));
  }
  definite.forEach((a) => traces.delete(a));
  return { allergens: inEu14Order(definite), traces: inEu14Order(traces) };
}

/** Facts straight from a page's schema.org Recipe: no model call. */
export function factsFromJsonLd(
  jsonLd: RecipeJsonLd,
  source: { url: string | null; site: string | null },
): RecipeFacts {
  const prep = parseIsoMinutes(jsonLd.prepTime);
  const cook = parseIsoMinutes(jsonLd.cookTime);
  const total = parseIsoMinutes(jsonLd.totalTime) ?? (prep !== null && cook !== null ? prep + cook : null);
  const lines = jsonLd.recipeIngredient ?? [];
  return {
    title: jsonLd.name?.trim() || null,
    source: { kind: "url", url: source.url, site: source.site, author: jsonLd.author?.trim() || null },
    servingsText: jsonLd.recipeYield?.trim() || null,
    ingredientCount: lines.length > 0 ? lines.length : null,
    minutes: { prep, cook, total },
    ...allergensOfLines(lines),
  };
}

/** Facts from a canonical recipe (after canonicalize, or the photo confirm screen). */
export function factsFromRecipe(recipe: CanonicalRecipe): RecipeFacts {
  const definite = new Set<Eu14Allergen>();
  const traces = new Set<Eu14Allergen>();
  for (const ingredient of recipe.ingredients) {
    ingredient.allergens.forEach((a) => definite.add(a));
    ingredient.allergenTraces.forEach((a) => traces.add(a));
  }
  definite.forEach((a) => traces.delete(a));
  return {
    title: recipe.title,
    source: {
      kind: recipe.source.kind,
      url: recipe.source.url ?? null,
      site: recipe.source.site ?? null,
      author: recipe.source.author ?? null,
    },
    servingsText: String(recipe.nativeServings),
    ingredientCount: recipe.ingredients.length,
    minutes: { prep: null, cook: null, total: null },
    allergens: inEu14Order(definite),
    traces: inEu14Order(traces),
  };
}

/** Facts from a finished artifact (a cache hit or a ?src= link). Times stay null: the cook along has its own total. */
export function factsFromArtifact(artifact: CookAlongArtifact): RecipeFacts {
  const recipe = artifact.recipe;
  const definite = new Set<Eu14Allergen>(recipe.allergens);
  const traces = new Set<Eu14Allergen>(rollUpTraces(recipe.ingredients));
  definite.forEach((a) => traces.delete(a));
  return {
    title: recipe.title,
    source: {
      kind: recipe.credit.kind,
      url: recipe.credit.url ?? null,
      site: recipe.credit.site ?? null,
      author: recipe.credit.author ?? null,
    },
    servingsText: String(recipe.nativeServings ?? recipe.servings),
    ingredientCount: recipe.ingredients.length,
    minutes: { prep: null, cook: null, total: null },
    allergens: inEu14Order(definite),
    traces: inEu14Order(traces),
  };
}

/**
 * Newer facts win field by field where they know something; allergens only
 * grow (a later source never hides an allergen an earlier one found).
 */
export function mergeFacts(earlier: RecipeFacts | null, later: RecipeFacts): RecipeFacts {
  if (!earlier) return later;
  const definite = new Set<Eu14Allergen>([...earlier.allergens, ...later.allergens]);
  const traces = new Set<Eu14Allergen>([...earlier.traces, ...later.traces]);
  definite.forEach((a) => traces.delete(a));
  return {
    title: later.title ?? earlier.title,
    source: {
      kind: later.source.kind,
      url: later.source.url ?? earlier.source.url,
      site: later.source.site ?? earlier.source.site,
      author: later.source.author ?? earlier.source.author,
    },
    // The posted yield ("12 muffins") reads better than a bare number.
    servingsText: earlier.servingsText ?? later.servingsText,
    ingredientCount: later.ingredientCount ?? earlier.ingredientCount,
    minutes: {
      prep: later.minutes.prep ?? earlier.minutes.prep,
      cook: later.minutes.cook ?? earlier.minutes.cook,
      total: later.minutes.total ?? earlier.minutes.total,
    },
    allergens: inEu14Order(definite),
    traces: inEu14Order(traces),
  };
}
