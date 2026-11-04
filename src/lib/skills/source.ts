import { fetchAndExtract, normalizeUrl, type RecipeJsonLd, type UrlExtraction } from "../intake/url";

/** Readable recipe text returned to assistants is capped at this length. */
export const MAX_SOURCE_TEXT_CHARS = 60_000;

export type SourceErrorCode = "refused_url" | "multiple_recipes" | "fetch_failed" | "not_a_recipe";

export interface RecipeSource {
  /** Final canonical https URL: credit links here. */
  url: string;
  site: string | null;
  author: string | null;
  title: string | null;
  jsonLd: RecipeJsonLd | null;
  /** Readable recipe text (structured lines first, then the page text). */
  text: string;
}

export type SourceResult =
  | { ok: true; source: RecipeSource }
  | { ok: false; error: { code: SourceErrorCode; message: string } };

export type Extractor = (url: string) => Promise<UrlExtraction>;

function refused(message: string): SourceResult {
  return { ok: false, error: { code: "refused_url", message } };
}

/** Classify an intake error message into a C3.2 error code. */
export function classifyIntakeError(message: string): SourceErrorCode {
  if (/single-recipe pages only/i.test(message)) return "multiple_recipes";
  if (/invalid url|only public https|credentials|private-network/i.test(message)) return "refused_url";
  return "fetch_failed";
}

function readableText(extraction: UrlExtraction): string {
  const parts: string[] = [];
  if (extraction.title) parts.push(extraction.title);
  if (extraction.author) parts.push(`By ${extraction.author}`);
  if (extraction.servingsRaw) parts.push(`Yield: ${extraction.servingsRaw}`);
  if (extraction.ingredientLines.length > 0) {
    parts.push("", "Ingredients:", ...extraction.ingredientLines.map((line) => `- ${line}`));
  }
  if (extraction.instructionLines.length > 0) {
    parts.push("", "Instructions:", ...extraction.instructionLines.map((line, i) => `${i + 1}. ${line}`));
  }
  if (extraction.rawText) parts.push("", "Page text:", extraction.rawText);
  const text = parts.join("\n").trim();
  return text.length > MAX_SOURCE_TEXT_CHARS ? text.slice(0, MAX_SOURCE_TEXT_CHARS) : text;
}

/** A measured amount such as "2 tablespoons", "1/2 teaspoon" or "250 g". */
const MEASURED_AMOUNT =
  /(?:\d+(?:[./]\d+)?|[½¼¾⅓⅔⅛])\s*(?:to\s*\d+\s*)?(?:cups?|tablespoons?|tbsps?|teaspoons?|tsps?|grams?|g|kg|ml|milliliters?|millilitres?|liters?|litres?|ounces?|oz|pounds?|lbs?)\b/gi;

/** Measured amounts that mark a page's text as recipe text. */
export const MIN_MEASURED_AMOUNTS = 3;

/**
 * Does a page without schema.org JSON-LD hold a recipe? Either both the
 * "ingredients" and "instructions" headings appear, or the text names a few
 * measured amounts. Blog recipe cards (for example Jetpack's) often head
 * their lists "Assembly" or leave out the "Directions" heading, so the
 * headings alone miss real recipes.
 */
export function looksLikeRecipe(extraction: UrlExtraction): boolean {
  if (extraction.hasJsonLd) return true;
  const text = extraction.rawText;
  if (/ingredients?/i.test(text) && /(instructions|directions|method|steps?)\b/i.test(text)) return true;
  return (text.match(MEASURED_AMOUNT) ?? []).length >= MIN_MEASURED_AMOUNTS;
}

/**
 * Fetch and extract one recipe page through the SSRF-guarded intake
 * (public https only, private networks refused, size and redirect caps).
 * No model calls.
 */
export async function getRecipeSource(
  rawUrl: string,
  extract: Extractor = fetchAndExtract,
): Promise<SourceResult> {
  const trimmed = rawUrl.trim();
  let normalized: string;
  try {
    normalized = normalizeUrl(trimmed);
  } catch {
    return refused("That is not a valid URL. Send the full https link to the recipe page.");
  }
  if (!normalized.startsWith("https://")) {
    return refused("Only https recipe pages can be read. Send the https link.");
  }
  let extraction: UrlExtraction;
  try {
    extraction = await extract(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed.";
    const code = classifyIntakeError(message);
    const friendly: Record<SourceErrorCode, string> = {
      refused_url: "That address is refused: use a public https recipe page.",
      multiple_recipes:
        "That page holds several recipes. Ask the person which one they want, then send that recipe's own link or paste its text.",
      fetch_failed: `The recipe page could not be read (${message.replace(/https?:\/\/\S+/g, "[url]")}). Ask the person to paste the recipe text instead.`,
      not_a_recipe: "",
    };
    return { ok: false, error: { code, message: friendly[code] } };
  }
  if (!looksLikeRecipe(extraction)) {
    return {
      ok: false,
      error: {
        code: "not_a_recipe",
        message: "No recipe was found on that page. Ask the person for the recipe's own page, or to paste the recipe text.",
      },
    };
  }
  const canonical = extraction.canonicalUrl.startsWith("https://")
    ? extraction.canonicalUrl
    : extraction.finalUrl;
  return {
    ok: true,
    source: {
      url: canonical,
      site: extraction.site ?? null,
      author: extraction.author ?? null,
      title: extraction.title ?? null,
      jsonLd: extraction.jsonLd ?? null,
      text: readableText(extraction),
    },
  };
}
