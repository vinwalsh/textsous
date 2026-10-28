import type { CanonicalRecipe } from "../schema/canonical";
import {
  TIMELINE_SCHEMA_NAME,
  TimelineDefinitionSchema,
  type TimelineDefinition,
} from "../schema/timeline";
import { callStructured, type ProviderName, type TokenUsage } from "../model";

export const PROCEDURE_VERSION = 1;
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

function sourcePool(recipe: CanonicalRecipe): string {
  return [
    recipe.title,
    ...recipe.ingredients.flatMap((ing) => [ing.name, ing.quantity, ing.unit]),
    ...recipe.steps.map((s) => s.text),
  ].join("\n");
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

  const pool = sourcePool(recipe);
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

const SYSTEM_PROMPT = `You convert a canonical recipe into a TextSous component-lane cooking timeline. Rules:
- Lanes: one lane per component present in THIS recipe (sauce, protein, base, side, garnish - only those that exist), kind "component". Plus exactly one kitchen lane (id "lane-kitchen", kind "kitchen") LAST, for shared and equipment work.
- Phases prep/cook/finish. Prep is mise en place only; every prep task must finish before the first cook task starts (express with dependencies).
- Split atomic hands-on work from unattended intervals: never one long hands-on task containing waiting. A sear plus a simmer is two tasks with a dependency, not one.
- One cook: chain hands-on tasks with dependencies so a single person does them in order. Unattended tasks overlap other work; depend on them only where truly required.
- Shared tasks execute once (one preheat task, not one per dish).
- attention is "hands-on" when the cook actively works, "unattended" when the oven, pot or timer does the work.
- timingBasis is "source" ONLY when the duration is stated exactly in the source steps: then copy ONE exact quote (a few words, verbatim) into sourceQuote. Otherwise "estimate" with sourceQuote null. minutes is 1-180; range {low, high} when the source gives a span.
- timerEnabledByDefault is true ONLY for exact source durations, else false.
- Every task cites at least one canonical step id in sourceStepIds, and only steps it actually comes from. laneIds holds at least one lane.
- dependencies lists task ids that must finish first. scheduling.waits holds seconds, multiples of 60 only (else empty); scheduling.resourceIds and scheduling.ingredientIds cite resource and canonical ingredient ids.
- Declare pans, burners and the oven as resources, and link tasks to them with resourceHolds. equipmentEvent is "oven-on" at the preheat task, "oven-off" when the oven is no longer needed, else null.
- cardTitle {action, subject, context} is short; label is short; description is 1-2 sentences; completionCue is observable (color, texture, thermometer); longer hands-on tasks get checkpoints (observable sub-cues); tip is optional.
- serveTaskId is the final plating or serving task.
- Fidelity: never invent ingredients, quantities, timings or equipment. Never schedule: no start or end times - dependencies and holds only, code schedules.
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
  opts: { provider?: ProviderName } = {},
): Promise<ProcedureResult> {
  const result = await callStructured(
    TimelineDefinitionSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(recipe) },
    ],
    {
      provider: opts.provider,
      schemaName: TIMELINE_SCHEMA_NAME,
      maxTokens: PROCEDURE_MAX_TOKENS,
    },
  );
  return {
    timeline: result.data,
    checks: runProcedureChecks(recipe, result.data),
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
    rawResponse: result.rawContent,
  };
}
