import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Lenient request body of POST /api/skills/cook-along (contract C3.3).
 *
 * An AI assistant writes this with its own model. Optional fields may be left
 * out: `normalize()` fills ids, lane colors, timers, scheduling and the serve
 * task, then the result is validated strictly against the real canonical and
 * timeline schemas. Unknown keys are dropped and reported as warnings.
 */

const text = (description: string) => z.string().describe(description);
const optionalText = (description: string) => z.string().nullish().describe(description);
const idList = (description: string) => z.array(z.string()).nullish().describe(description);

export const SkillsSourceSchema = z
  .object({
    kind: z
      .enum(["url", "text", "photo"])
      .describe('"url" for a recipe web page, "text" for pasted text, "photo" for a photo you transcribed.'),
    url: optionalText("The recipe page URL (https). Required for kind url."),
    site: optionalText("Site or publication name, as credited by the source."),
    author: optionalText("Recipe author, as credited by the source."),
    book: optionalText("Cookbook title, for a photo of a book page."),
    page: z.number().int().positive().nullish().describe("Cookbook page number, if visible."),
    license: optionalText("License of the recipe text, when the source states one."),
    text: optionalText(
      "The recipe text you worked from, exactly as written. Required for text and photo; for url the server fetches it again.",
    ),
  })
  .describe("Where the recipe came from. Used for credit and to check timing quotes.");

export const SkillsIngredientSchema = z.object({
  id: optionalText('Optional id like "ing-1". Defaults to ing-<position>.'),
  name: text('Ingredient name without the amount, e.g. "rolled oats".'),
  quantity: z
    .union([z.string(), z.number()])
    .nullish()
    .describe('Amount exactly as printed, e.g. "1 1/2". Empty when the source gives none.'),
  unit: optionalText('Unit exactly as printed, e.g. "cups". Empty when there is none.'),
  note: optionalText('Preparation or descriptor from the ingredient line, e.g. "diced".'),
  allergens: z
    .array(z.string())
    .nullish()
    .describe(
      "EU-14 allergen slugs this ingredient contains: celery, gluten, crustaceans, egg, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites. Empty means unknown, never allergen-free.",
    ),
  allergenTraces: z
    .array(z.string())
    .nullish()
    .describe('EU-14 slugs the source says it "may contain".'),
});

export const SkillsStepSchema = z.object({
  id: optionalText('Optional id like "step-1". Defaults to step-<position>.'),
  kind: z
    .enum(["prep", "active"])
    .nullish()
    .describe('"prep" for a mise en place step the source states on its own, "active" (default) for method steps.'),
  text: text("The step text, verbatim from the source."),
});

export const SkillsRecipeSchema = z.object({
  title: text("Recipe title as printed."),
  cuisine: optionalText("Cuisine, if the source names one."),
  servings: z.number().positive().describe("Servings the source makes, as a number."),
  ingredients: z.array(SkillsIngredientSchema).describe("Every ingredient line, in source order."),
  steps: z.array(SkillsStepSchema).describe("Every method step, in source order."),
  equipment: z.array(z.string()).nullish().describe("Equipment the source names."),
});

export const SkillsLaneSchema = z.object({
  id: text('Lane id, e.g. "lane-sauce" or "lane-kitchen".'),
  label: text('Short component name, e.g. "Sauce".'),
  kind: z
    .enum(["component", "kitchen"])
    .nullish()
    .describe('"component" for a dish component, "kitchen" for the one shared lane that comes last.'),
  color: optionalText("Optional CSS hex color. Filled by the server when missing."),
});

export const SkillsCardTitleSchema = z.object({
  action: text('Verb, e.g. "Simmer". No amounts, times or temperatures.'),
  subject: text('What is acted on, e.g. "porridge". No amounts, times or temperatures.'),
  context: optionalText('Short context, e.g. "with milk". May be empty.'),
});

export const SkillsTaskSchema = z.object({
  id: optionalText('Optional id like "task-toast-oats". Defaults to task-<slug of label>.'),
  phase: z
    .enum(["prep", "cook", "finish"])
    .describe('"prep" for mise en place, "cook" for cooking, "finish" for plating and serving.'),
  label: text("Short task name. No amounts, times or temperatures."),
  cardTitle: SkillsCardTitleSchema.nullish().describe("Card title. Derived from label when missing."),
  description: text("What to do, with exact amounts, units and ingredient names."),
  completionCue: text("An observable sign the task is done: color, texture, smell, sound or temperature."),
  minutes: z.number().describe("Whole minutes, 1 to 180."),
  range: z
    .object({ low: z.number(), high: z.number() })
    .nullish()
    .describe("Minute span when the source gives one, e.g. 8 to 10."),
  timingBasis: z
    .enum(["source", "estimate"])
    .describe('"source" only when the source states this exact duration (then give sourceQuote); otherwise "estimate".'),
  sourceQuote: optionalText(
    'For timingBasis "source": the exact words from the step text, e.g. "simmer 6 minutes". Leave out for estimates.',
  ),
  attention: z
    .enum(["hands-on", "unattended"])
    .describe('"hands-on" when the cook is working, "unattended" when the oven, pot or timer does the work.'),
  laneIds: z.array(z.string()).describe("Lanes this task belongs to (at least one)."),
  dependencies: idList("Task ids that must finish before this one starts."),
  sourceStepIds: z.array(z.string()).describe("Step ids this task comes from (at least one)."),
  checkpoints: z
    .array(z.string())
    .nullish()
    .describe("Observable sub-cues. Required for hands-on tasks over 15 minutes."),
  tip: optionalText("Optional: at most one short tip, only from the source's own advice."),
  why: optionalText(
    "Optional: one sentence on why this task matters or is done this way. No health or nutrition claims.",
  ),
  equipmentEvent: z
    .enum(["oven-on", "oven-off"])
    .nullish()
    .describe('"oven-on" on the preheat task, "oven-off" once the oven is no longer needed.'),
  ingredientIds: idList("Ingredient ids this task uses. Every ingredient must be used by some task."),
  resourceIds: idList("Resource ids (pans, burners, oven) this task holds."),
});

export const SkillsResourceSchema = z.object({
  id: text('Resource id, e.g. "res-skillet".'),
  label: text('Name, e.g. "Large skillet".'),
  kind: text('Kind, e.g. "pan", "burner" or "oven".'),
});

export const SkillsResourceHoldSchema = z.object({
  taskId: text("Task that holds the resource."),
  resourceId: text("Resource it holds."),
});

export const SkillsTimelineSchema = z.object({
  lanes: z.array(SkillsLaneSchema).describe("Component lanes first, then exactly one kitchen lane last."),
  tasks: z.array(SkillsTaskSchema).describe("Every task, in cooking order. Do not give start times."),
  resources: z.array(SkillsResourceSchema).nullish(),
  resourceHolds: z.array(SkillsResourceHoldSchema).nullish(),
  serveTaskId: optionalText("The final serving task. Defaults to the last finish task."),
});

export const CookAlongRequestSchema = z.object({
  source: SkillsSourceSchema,
  recipe: SkillsRecipeSchema,
  timeline: SkillsTimelineSchema,
});

export type SkillsSource = z.infer<typeof SkillsSourceSchema>;
export type SkillsRecipe = z.infer<typeof SkillsRecipeSchema>;
export type SkillsTask = z.infer<typeof SkillsTaskSchema>;
export type SkillsTimeline = z.infer<typeof SkillsTimelineSchema>;
export type CookAlongRequest = z.infer<typeof CookAlongRequestSchema>;

function stripMeta(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripMeta);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || key === "$ref" || key === "definitions") continue;
    out[key] = stripMeta(value);
  }
  return out;
}

/** Inline JSON Schema (no $ref) of the lenient cook-along body. */
export function cookAlongInputJsonSchema(): Record<string, unknown> {
  const raw = zodToJsonSchema(CookAlongRequestSchema, { $refStrategy: "none" });
  return stripMeta(raw) as Record<string, unknown>;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      current = current._def.innerType;
    } else {
      return current;
    }
  }
}

/** Paths of keys the lenient schema does not know (zod drops them silently). */
export function unknownKeyPaths(schema: z.ZodTypeAny, value: unknown, path = ""): string[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const found: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in shape)) found.push(childPath);
      else found.push(...unknownKeyPaths(shape[key], child, childPath));
    }
    return found;
  }
  if (inner instanceof z.ZodArray && Array.isArray(value)) {
    return value.flatMap((item, i) => unknownKeyPaths(inner.element as z.ZodTypeAny, item, `${path}[${i}]`));
  }
  return [];
}
