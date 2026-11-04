import { z } from "zod";
import { EU14_ALLERGENS, type CanonicalRecipe, type Eu14Allergen } from "../schema/canonical";
import {
  mergeFacts,
  type RecipeFacts,
  type RecipeOverview,
} from "../convert-events";
import { cleanTitle } from "../format";
import {
  callStructured,
  effortFor,
  type EffortOverrides,
  type ProviderName,
  type ReasoningEffort,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { canonicalizeSourcePrompt, type CanonicalizeInput } from "./canonicalize";

/**
 * Overview stage (M8): one fast call for a first read of the recipe (facts,
 * a short summary and its components) while the cook along is still being
 * built. Streaming only, never cached, never part of the artifact; its
 * failure never fails or delays a conversion.
 */
export const OVERVIEW_VERSION = 1;
export const OVERVIEW_MAX_TOKENS = 1200;
export const OVERVIEW_SCHEMA_NAME = "recipe_overview_v1";

/** Display limits, applied in code after the model (the prompt asks for them too). */
export const OVERVIEW_SUMMARY_MAX_CHARS = 280;
export const OVERVIEW_COMPONENT_NAME_MAX_CHARS = 40;
export const OVERVIEW_COMPONENT_HOW_MAX_CHARS = 160;
export const OVERVIEW_MAX_COMPONENTS = 6;

export const OverviewComponentSchema = z.strictObject({
  name: z.string().min(1),
  how: z.string().min(1),
});

export const OverviewSchema = z.strictObject({
  title: z.string().min(1),
  servingsText: z.string().nullable(),
  ingredientCount: z.number().int().min(0).nullable(),
  totalMinutes: z.number().int().min(0).nullable(),
  allergens: z.array(z.enum(EU14_ALLERGENS)),
  summary: z.string().min(1),
  components: z.array(OverviewComponentSchema).min(1),
});

export type OverviewOutput = z.infer<typeof OverviewSchema>;

/** What the overview reads: the source canonicalize gets, or a confirmed recipe. */
export type OverviewSource = { input: CanonicalizeInput } | { recipe: CanonicalRecipe };

export interface OverviewResult {
  overview: RecipeOverview;
  /** Facts from this call alone (merge with page facts via fillFacts). */
  facts: RecipeFacts;
  usage: TokenUsage;
  /** Verbatim successful model completion. */
  rawResponse: string;
}

const SYSTEM_PROMPT = `You give a home cook a quick first read of one recipe while its full cook along is still being prepared. Rules:
- Use only what the source says. Never invent ingredients, amounts, times or steps.
- title: the dish's name only, without site names, "Recipe", emoji or marketing tags.
- servingsText: the servings or yield exactly as the source posts it ("Serves 4", "12 muffins"); null when it posts none.
- ingredientCount: how many ingredient lines the source lists; null when unclear.
- totalMinutes: the total time the source states, in minutes; null when it states none. Never estimate.
- allergens: EU-14 codes (${EU14_ALLERGENS.join(", ")}) that the listed ingredients definitely contain by name. Leave out anything uncertain: an empty list means unknown, never allergen-free.
- summary: one or two calm sentences in the second person on what you will do, at most 280 characters ("You'll sear the chicken, then simmer it in a quick tomato sauce."). No praise, no health or nutrition claims.
- components: the 1 to 6 parts of the dish in cooking order (for example sauce, protein, base, side, garnish). name: a few words, at most 40 characters. how: one short sentence naming the method and the key ingredients ("Simmered with crushed tomatoes, garlic and basil.").
Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(source: OverviewSource): string {
  if ("input" in source) return canonicalizeSourcePrompt(source.input);
  const recipe = source.recipe;
  return JSON.stringify({
    title: recipe.title,
    servings: recipe.nativeServings,
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      note: i.note ?? null,
    })),
    steps: recipe.steps.map((s) => ({ kind: s.kind, text: s.text })),
    equipment: recipe.equipment,
  });
}

/** Cut text to max characters at a word boundary, with an ellipsis. */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function sourceOf(source: OverviewSource): RecipeFacts["source"] {
  const s = "input" in source ? source.input.source : source.recipe.source;
  return {
    kind: s.kind,
    url: s.url ?? null,
    site: s.site ?? null,
    author: s.author ?? null,
  };
}

/** Map the model's overview to facts and the overview event. Pure. */
export function mapOverview(
  data: OverviewOutput,
  source: OverviewSource,
): { facts: RecipeFacts; overview: RecipeOverview } {
  const credit = sourceOf(source);
  const allergens = new Set<Eu14Allergen>(data.allergens);
  const title = cleanTitle(data.title, credit.site);
  return {
    facts: {
      title: title || null,
      source: credit,
      servingsText: data.servingsText?.trim() || null,
      ingredientCount: data.ingredientCount && data.ingredientCount > 0 ? data.ingredientCount : null,
      minutes: {
        prep: null,
        cook: null,
        total: data.totalMinutes && data.totalMinutes > 0 ? data.totalMinutes : null,
      },
      allergens: EU14_ALLERGENS.filter((a) => allergens.has(a)),
      traces: [],
    },
    overview: {
      summary: clampText(data.summary, OVERVIEW_SUMMARY_MAX_CHARS),
      components: data.components
        .map((c) => ({
          name: clampText(c.name, OVERVIEW_COMPONENT_NAME_MAX_CHARS),
          how: clampText(c.how, OVERVIEW_COMPONENT_HOW_MAX_CHARS),
        }))
        .filter((c) => c.name && c.how)
        .slice(0, OVERVIEW_MAX_COMPONENTS),
    },
  };
}

/**
 * Facts a page states (its schema.org Recipe) win where they know
 * something; the overview fills the gaps, and allergens only grow.
 */
export function fillFacts(known: RecipeFacts | null, extra: RecipeFacts): RecipeFacts {
  if (!known) return extra;
  const merged = mergeFacts(extra, known);
  return { ...merged, servingsText: known.servingsText ?? extra.servingsText };
}

/** One fast structured call: facts, a short summary and the components. */
export async function overview(
  source: OverviewSource,
  opts: {
    provider?: ProviderName;
    client?: StructuredChatClient;
    /** Wins over efforts and the env/code default (effortFor("overview")). */
    reasoningEffort?: ReasoningEffort;
    efforts?: EffortOverrides;
  } = {},
): Promise<OverviewResult> {
  const result = await callStructured(
    OverviewSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(source) },
    ],
    {
      provider: opts.provider,
      client: opts.client,
      schemaName: OVERVIEW_SCHEMA_NAME,
      maxTokens: OVERVIEW_MAX_TOKENS,
      reasoningEffort: opts.reasoningEffort ?? effortFor("overview", opts.efforts),
    },
  );
  const mapped = mapOverview(result.data, source);
  return { ...mapped, usage: result.usage, rawResponse: result.rawContent };
}
