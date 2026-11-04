import type { CanonicalRecipe } from "../schema/canonical";
import {
  TIMELINE_SCHEMA_NAME,
  TimelineDefinitionSchema,
  type TimelineDefinition,
} from "../schema/timeline";
import {
  callStructured,
  effortFor,
  type EffortOverrides,
  type ProviderName,
  type ReasoningEffort,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { polishTimeline, sourceTimingPool } from "../format";

// Bumped on every prompt round deployed: preview and production share one
// conversion cache, keyed by stage versions.
export const PROCEDURE_VERSION = 4;
export const PROCEDURE_MAX_TOKENS = 24000;

export type ProcedureCheckName =
  | "source_step_ids"
  | "source_quotes"
  | "task_references"
  | "lanes"
  | "timers";

export interface ProcedureCheck {
  name: ProcedureCheckName;
  passed: boolean;
  detail: string;
}

export interface ProcedureResult {
  timeline: TimelineDefinition;
  checks: ProcedureCheck[];
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
  /** Verbatim successful model completion (for --record). */
  rawResponse: string;
  /** Readable notes on what code repaired after the model (timing labels). */
  repairs: string[];
}

/** Format of eval/recordings/procedure-*.json, written by `procedure --record`. */
export interface ProcedureRecordingFile {
  version: 1;
  fixture: string;
  provider: ProviderName;
  model: string;
  recordedAt: string;
  usage: TokenUsage;
  recipe: CanonicalRecipe;
  /** Verbatim successful model completion. */
  response: string;
}

/**
 * Deterministic checks of a timeline against its canonical recipe. Pure: no
 * model calls, safe for offline tests. Reused by the M2.4 review stage.
 */
export function runProcedureChecks(
  recipe: CanonicalRecipe,
  timeline: TimelineDefinition,
): ProcedureCheck[] {
  const checks: ProcedureCheck[] = [];
  const stepIds = new Set(recipe.steps.map((s) => s.id));
  const taskIds = new Set(timeline.tasks.map((t) => t.id));
  const laneIds = new Set(timeline.lanes.map((l) => l.id));
  const resourceIds = new Set(timeline.resources.map((r) => r.id));
  const ingredientIds = new Set(recipe.ingredients.map((i) => i.id));

  const badStepRefs = timeline.tasks.flatMap((t) =>
    t.sourceStepIds.filter((id) => !stepIds.has(id)).map((id) => `${t.id}->${id}`),
  );
  checks.push({
    name: "source_step_ids",
    passed: badStepRefs.length === 0,
    detail:
      badStepRefs.length === 0
        ? "every sourceStepId cites a canonical step"
        : `unknown step ids: ${badStepRefs.join("; ")}`,
  });

  const pool = sourceTimingPool(recipe);
  const quoteViolations: string[] = [];
  for (const task of timeline.tasks) {
    const quote = task.sourceQuote ?? "";
    if (task.timingBasis === "source") {
      if (!quote) quoteViolations.push(`${task.id}: source timing without a quote`);
      else if (!pool.includes(quote)) quoteViolations.push(`${task.id}: quote not in source`);
    } else if (quote) {
      quoteViolations.push(`${task.id}: estimate timing carries a quote`);
    }
  }
  checks.push({
    name: "source_quotes",
    passed: quoteViolations.length === 0,
    detail:
      quoteViolations.length === 0
        ? "source timings carry one verbatim quote each, estimates carry none"
        : quoteViolations.join("; "),
  });

  const brokenRefs: string[] = [];
  if (taskIds.size !== timeline.tasks.length) brokenRefs.push("duplicate task ids");
  for (const task of timeline.tasks) {
    for (const dep of task.dependencies) {
      if (dep === task.id) brokenRefs.push(`${task.id} depends on itself`);
      else if (!taskIds.has(dep)) brokenRefs.push(`${task.id}->${dep} (dependency)`);
    }
    for (const lane of task.laneIds) {
      if (!laneIds.has(lane)) brokenRefs.push(`${task.id}->${lane} (lane)`);
    }
    for (const res of task.scheduling.resourceIds) {
      if (!resourceIds.has(res)) brokenRefs.push(`${task.id}->${res} (resource)`);
    }
    for (const ing of task.scheduling.ingredientIds) {
      if (!ingredientIds.has(ing)) brokenRefs.push(`${task.id}->${ing} (ingredient)`);
    }
  }
  if (!taskIds.has(timeline.serveTaskId)) {
    brokenRefs.push(`serveTaskId ${timeline.serveTaskId} is not a task`);
  }
  checks.push({
    name: "task_references",
    passed: brokenRefs.length === 0,
    detail:
      brokenRefs.length === 0
        ? "all task, lane, resource, ingredient and serve references resolve"
        : `broken references: ${brokenRefs.join("; ")}`,
  });

  const kitchenLanes = timeline.lanes.filter((l) => l.kind === "kitchen");
  const componentLanes = timeline.lanes.filter((l) => l.kind === "component");
  const lastLane = timeline.lanes[timeline.lanes.length - 1];
  const lanesOk =
    kitchenLanes.length === 1 && componentLanes.length >= 1 && lastLane?.kind === "kitchen";
  checks.push({
    name: "lanes",
    passed: lanesOk,
    detail: lanesOk
      ? "one component lane per component plus a final kitchen lane"
      : `expected >=1 component lane and exactly one kitchen lane last, got ${componentLanes.length} component + ${kitchenLanes.length} kitchen`,
  });

  const timerViolations = timeline.tasks
    .filter((t) => t.timerEnabledByDefault && t.timingBasis !== "source")
    .map((t) => t.id);
  checks.push({
    name: "timers",
    passed: timerViolations.length === 0,
    detail:
      timerViolations.length === 0
        ? "timers default on only for exact source durations"
        : `timer on without a source timing: ${timerViolations.join("; ")}`,
  });

  return checks;
}

const SYSTEM_PROMPT = `You turn a canonical recipe into a TextSous cook-along timeline: the cards a home cook follows at the stove, one card per task. Follow every rule.

LANES
- One lane per component that exists in THIS recipe (for example sauce, protein, base, side, garnish), kind "component", each with a distinct muted hex color. Then exactly one kitchen lane (id "lane-kitchen", kind "kitchen") LAST, for shared and equipment work.

1. MISE EN PLACE FIRST (phase "prep")
- Make a prep task for every preparation named in an ingredient's name or note, or in a prep step: trim, slice, dice, mince, chop, grate, zest, juice, peel, drain and rinse, measure out a dry mix, bring to room temperature. No preparation is skipped.
- Group prep naturally by component and tool, the way a cook works a cutting board: "Dice the onion and slice the mushrooms", "Mince the garlic and thyme". A prep task usually covers 1-3 ingredients.
- Seasoning raw protein ahead of cooking may be a prep task.
- Each prep task cites, in sourceStepIds, the source step that first uses those ingredients, and lists them in scheduling.ingredientIds.
- Prep tasks depend only on other prep tasks. All prep finishes before the first cook task (the scheduler enforces this).

2. AMOUNTS WHERE THE COOK READS
- Every description names each ingredient it uses with its exact amount, unit and name the first time that ingredient appears in the task, copied from the ingredient list: "Season the beef all over with 1 1/2 teaspoons kosher salt." "Dice 1 medium yellow onion."
- Write amounts the way a cook says them: amount, unit, size, name ("1 small garlic clove", "2 thick slices sourdough bread", "1 (15-ounce) can white beans"). Never paste the ingredient note after the name as a comma list; once an ingredient is prepped, call it by its prepared form ("the grated garlic").
- Divided ingredients show only the portion this task uses, as the source splits them: "the remaining 1/2 teaspoon salt", "1 tablespoon of the olive oil".
- Ingredients with no amount ("salt to taste") are named plainly. Free-text amounts read naturally mid-sentence ("half a red onion", "a handful of cilantro").
- A finished mixture or an earlier result is named directly, without amounts: "the prepared sauce", "the seared beef".
- cardTitle {action, subject, context} and label are short and NEVER carry amounts, times or temperatures: {action: "Sear", subject: "the beef", context: "in batches"}. context may be "".

3. BATCHES
- When the source cooks in batches or rounds, make ONE hands-on task for all rounds. The description keeps the round count (say "about 3 batches" when the source does not give one), the per-round or per-side time exactly as written, and how to load, turn and unload each round.
- minutes = rounds x per-round time (both sides when the time is per side). That total is an estimate: timingBasis "estimate", sourceQuote null, with a range {low, high} when the round count or the per-round time is a span.

4. SETUP vs WAITING
- Heating a pan or the oven, loading a pan, adding ingredients and stirring things in are short hands-on tasks.
- Simmering, baking, roasting, resting, marinating, chilling, rising and boiling water are separate "unattended" tasks with an observable completionCue and checkpoints, so the cook can do other work meanwhile. Only frequent stirring ("stirring constantly") keeps a cooking interval hands-on.
- Preheating the oven is the FIRST prep task: hands-on, 1 minute, equipmentEvent "oven-on", description with the temperature ("Heat the oven to 400°F."). The first task that puts food in the oven depends on it and has scheduling.waits [600] (the oven heats while the cook preps). The last oven task carries "oven-off".
- When the source turns the heat off or removes the pan from the heat, say so explicitly in the description.

5. PREPARED INPUTS
- When an ingredient is a prepared food the recipe assumes (cooked pasta, cooked rice, mashed potatoes, toasted bread, a stock made earlier), add ONE task in that component's lane to have it ready by serving time: cook-phase, timingBasis "estimate", sourceStepIds = the step that uses it, scheduling.ingredientIds = that ingredient. Describe it in one sentence ("Cook the pasta of your choice so it is ready to serve.") without inventing a sub-recipe, extra ingredients or amounts the source does not give.

6. FIDELITY AND TIMING
- Never invent ingredients, quantities, temperatures or equipment.
- When the source gives a time for this task ("about 5 minutes", "3-5 minutes"), keep that phrase in the description and use timingBasis "source" with it as sourceQuote. timingBasis "source" ONLY when this task's whole duration is stated exactly in the source: copy ONE short verbatim quote (a few words, exact characters) into sourceQuote. Otherwise "estimate" with sourceQuote null. minutes is a whole number 1-180; range {low, high} when the source gives a span (minutes is then within it).
- timerEnabledByDefault is true only for "source" timings.
- Every task cites at least one canonical step id in sourceStepIds, only steps it actually comes from.

7. TIPS AND WHY
- tip: at most one short, faithful tip that comes from the source's own advice, else null.
- why: one sentence of pure rationale (why this task matters or why it is done this way), for most cook tasks and any prep whose reason is not obvious, else null. Faithful to the source and sound cooking knowledge. No health or nutrition claims.
- Keep text tight: description 1-2 sentences, completionCue one short phrase, 1-3 checkpoints.
- completionCue is observable (color, texture, sound, thermometer). Hands-on tasks over 10 minutes and every unattended task get checkpoints (observable sub-cues).

8. STRUCTURE
- Phases prep, cook, finish. serveTaskId is the final plating or serving task (phase "finish").
- One cook: chain hands-on tasks with dependencies in the real cooking order. Unattended tasks overlap other work; depend on them only where truly required. Shared tasks happen once (one preheat).
- dependencies lists task ids that must finish first. scheduling.waits holds seconds in multiples of 60 only (else empty). scheduling.resourceIds and scheduling.ingredientIds cite resource ids and canonical ingredient ids; every ingredient appears in at least one task.
- Declare pans, burners and the oven as resources and link tasks to them with resourceHolds.
- Never schedule: no start or end times. Code schedules.
Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(recipe: CanonicalRecipe): string {
  return JSON.stringify({
    title: recipe.title,
    servings: recipe.nativeServings,
    ingredients: recipe.ingredients.map((ing) => ({
      id: ing.id,
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      note: ing.note ?? null,
    })),
    steps: recipe.steps.map((s) => ({ id: s.id, kind: s.kind, text: s.text })),
    equipment: recipe.equipment,
  });
}

/**
 * One structured call turning a canonical recipe into a timeline definition,
 * then deterministic checks against the recipe. Task ids are kept exactly as
 * the model wrote them: dependencies, lanes and holds reference them.
 */
export async function procedure(
  recipe: CanonicalRecipe,
  opts: {
    provider?: ProviderName;
    client?: StructuredChatClient;
    /** Wins over efforts and the env/code default (effortFor("procedure")). */
    reasoningEffort?: ReasoningEffort;
    efforts?: EffortOverrides;
  } = {},
): Promise<ProcedureResult> {
  const result = await callStructured(
    TimelineDefinitionSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(recipe) },
    ],
    {
      provider: opts.provider,
      client: opts.client,
      schemaName: TIMELINE_SCHEMA_NAME,
      maxTokens: PROCEDURE_MAX_TOKENS,
      reasoningEffort: opts.reasoningEffort ?? effortFor("procedure", opts.efforts),
    },
  );
  // Deterministic clean-up after the model: card titles, timing labels,
  // timers, one-sentence why. The checks judge the polished timeline.
  const polished = polishTimeline(recipe, result.data);
  return {
    timeline: polished.timeline,
    checks: runProcedureChecks(recipe, polished.timeline),
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
    rawResponse: result.rawContent,
    repairs: polished.repairs,
  };
}
