import { z } from "zod";
import type { EquipmentProfile } from "../schema/artifact";
import type { CanonicalRecipe } from "../schema/canonical";
import type { TimelineDefinition } from "../schema/timeline";
import type { ScheduleResult } from "../scheduler/schedule";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { runProcedureChecks } from "./procedure";

export const REVIEW_VERSION = 1;

/** All 12 review checks in canonical order. */
export const REVIEW_CHECK_ORDER = [
  "source_fidelity",
  "ingredient_coverage",
  "quantities",
  "dietary_conditions",
  "method_and_safety",
  "equipment_capacity",
  "task_schedule",
  "source_timing",
  "atomic_attention",
  "mise_en_place",
  "source_relationships",
  "tips_and_voice",
] as const;

export type ReviewCheckName = (typeof REVIEW_CHECK_ORDER)[number];

/** The 7 checks judged by one model call; the other 5 are coded below. */
export const MODEL_JUDGMENT_NAMES = [
  "source_fidelity",
  "quantities",
  "dietary_conditions",
  "method_and_safety",
  "equipment_capacity",
  "source_relationships",
  "tips_and_voice",
] as const;

export const ReviewJudgmentSchema = z.strictObject({
  name: z.enum(MODEL_JUDGMENT_NAMES),
  passed: z.boolean(),
  detail: z.string().min(1),
});

export const ReviewJudgmentsSchema = z.strictObject({
  checks: z.array(ReviewJudgmentSchema).min(1),
});

export const REVIEW_SCHEMA_NAME = "review_judgments_v1";

export interface ReviewInput {
  recipe: CanonicalRecipe;
  timeline: TimelineDefinition;
  schedule: ScheduleResult;
  equipmentProfile: EquipmentProfile;
}

export interface ReviewCheck {
  name: ReviewCheckName;
  passed: boolean;
  detail: string;
  source: "code" | "model";
}

export interface ReviewResult {
  checks: ReviewCheck[];
  passed: boolean;
  /** One readable reason per failed check; non-empty blocks compile. */
  blockers: string[];
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
  /** Verbatim model judgments completion. */
  rawResponse: string;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

function taskScheduleCheck(
  timeline: TimelineDefinition,
  schedule: ScheduleResult,
): ReviewCheck {
  const violations: string[] = [];
  const sched = new Map(schedule.tasks.map((t) => [t.id, t] as const));
  const taskIds = new Set(timeline.tasks.map((t) => t.id));
  for (const id of taskIds) {
    if (!sched.has(id)) violations.push(`missing from schedule: ${id}`);
  }
  for (const entry of schedule.tasks) {
    if (!taskIds.has(entry.id)) violations.push(`unknown scheduled task: ${entry.id}`);
  }
  for (const task of timeline.tasks) {
    const s = sched.get(task.id);
    if (!s) continue;
    if (s.endMinutes - s.startMinutes !== task.minutes) {
      violations.push(
        `${task.id}: scheduled for ${s.endMinutes - s.startMinutes}m but needs ${task.minutes}m`,
      );
    }
    const depEnd = Math.max(0, ...task.dependencies.map((d) => sched.get(d)?.endMinutes ?? 0));
    const waitsMin = task.scheduling.waits.reduce((a, w) => a + w, 0) / 60;
    if (s.startMinutes < depEnd + waitsMin - 1e-9) {
      violations.push(`${task.id}: starts before its dependencies and waits clear`);
    }
  }
  const handsOn = timeline.tasks.filter((t) => t.attention === "hands-on" && sched.has(t.id));
  for (let i = 0; i < handsOn.length; i += 1) {
    for (let j = i + 1; j < handsOn.length; j += 1) {
      const a = sched.get(handsOn[i].id);
      const b = sched.get(handsOn[j].id);
      if (a && b && overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) {
        violations.push(`hands-on overlap: ${handsOn[i].id} + ${handsOn[j].id}`);
      }
    }
  }
  const holders = new Map<string, string[]>();
  const hold = (taskId: string, resourceId: string): void => {
    holders.set(resourceId, [...(holders.get(resourceId) ?? []), taskId]);
  };
  for (const task of timeline.tasks) {
    for (const resource of task.scheduling.resourceIds) hold(task.id, resource);
  }
  for (const resourceHold of timeline.resourceHolds) hold(resourceHold.taskId, resourceHold.resourceId);
  for (const [resource, ids] of holders) {
    // A task may hold a resource through both channels (top-level holds and
    // its own scheduling.resourceIds): dedupe before comparing pairs.
    const placed = [...new Set(ids)].filter((id) => sched.has(id));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = sched.get(placed[i]);
        const b = sched.get(placed[j]);
        if (a && b && overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) {
          violations.push(`resource ${resource} double-booked: ${placed[i]} + ${placed[j]}`);
        }
      }
    }
  }
  return {
    name: "task_schedule",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? "schedule covers every task with exact durations, respected dependencies, waits, holds and one cook"
        : violations.join("; "),
    source: "code",
  };
}

/**
 * The 5 coded checks. Pure: no model calls, safe for offline tests.
 * source_timing reuses the procedure-stage checks rather than duplicating them.
 */
export function runCodedReviewChecks(input: ReviewInput): ReviewCheck[] {
  const { recipe, timeline, schedule } = input;
  const sched = new Map(schedule.tasks.map((t) => [t.id, t] as const));

  const citedIngredients = new Set(
    timeline.tasks.flatMap((t) => t.scheduling.ingredientIds),
  );
  const knownIngredients = new Set(recipe.ingredients.map((i) => i.id));
  const unused = recipe.ingredients.map((i) => i.id).filter((id) => !citedIngredients.has(id));
  const unknown = [...citedIngredients].filter((id) => !knownIngredients.has(id));
  const coverageProblems = [
    ...unused.map((id) => `unused: ${id}`),
    ...unknown.map((id) => `unknown: ${id}`),
  ];
  const ingredientCoverage: ReviewCheck = {
    name: "ingredient_coverage",
    passed: coverageProblems.length === 0,
    detail:
      coverageProblems.length === 0
        ? "every recipe ingredient is used by a task"
        : coverageProblems.join("; "),
    source: "code",
  };

  const prepEnds = timeline.tasks
    .filter((t) => t.phase === "prep")
    .map((t) => sched.get(t.id)?.endMinutes)
    .filter((v): v is number => v !== undefined);
  const cookStarts = timeline.tasks
    .filter((t) => t.phase === "cook")
    .map((t) => sched.get(t.id)?.startMinutes)
    .filter((v): v is number => v !== undefined);
  const miseOk =
    prepEnds.length === 0 ||
    cookStarts.length === 0 ||
    Math.max(...prepEnds) <= Math.min(...cookStarts);
  const miseEnPlace: ReviewCheck = {
    name: "mise_en_place",
    passed: miseOk,
    detail: miseOk
      ? "all prep ends before the first cook task starts"
      : `prep runs to ${Math.max(...prepEnds)}m but cooking starts at ${Math.min(...cookStarts)}m`,
    source: "code",
  };

  const taskSchedule = taskScheduleCheck(timeline, schedule);

  const procedureChecks = runProcedureChecks(recipe, timeline);
  const quotes = procedureChecks.find((c) => c.name === "source_quotes");
  const timers = procedureChecks.find((c) => c.name === "timers");
  const timingOk = (quotes?.passed ?? false) && (timers?.passed ?? false);
  const sourceTiming: ReviewCheck = {
    name: "source_timing",
    passed: timingOk,
    detail: `quotes: ${quotes?.detail ?? "missing"}; timers: ${timers?.detail ?? "missing"}`,
    source: "code",
  };

  const oversized = timeline.tasks
    .filter((t) => t.attention === "hands-on" && t.minutes > 15 && t.checkpoints.length === 0)
    .map((t) => t.id);
  const atomicAttention: ReviewCheck = {
    name: "atomic_attention",
    passed: oversized.length === 0,
    detail:
      oversized.length === 0
        ? "no hands-on task over 15 minutes lacks a checkpoint"
        : `hands-on over 15m without a checkpoint: ${oversized.join("; ")}`,
    source: "code",
  };

  return [ingredientCoverage, taskSchedule, sourceTiming, atomicAttention, miseEnPlace];
}

const SYSTEM_PROMPT = `You review a cooking timeline against its canonical recipe. Judge each of these checks pass or fail with one sentence each:
- source_fidelity: every task traces to its cited canonical steps; no invented ingredients, quantities, timings or equipment.
- quantities: amounts are carried exactly as printed; servings math is untouched (scaling is a later stage).
- dietary_conditions: no dietary variant is applied yet; pass when every timeline ingredient comes from the recipe with its allergen tags intact, fail on any new ingredient or allergen concern.
- method_and_safety: cooking methods match the source; no unsafe times or temperatures invented; no nutrition or health claims anywhere.
- equipment_capacity: concurrent demands on burners, the oven and pans fit the given kitchen profile; fail on over-subscription.
- source_relationships: lanes group genuinely related work and dependencies reflect the real cooking order; fail on false sequencing.
- tips_and_voice: completion cues are observable and tips useful where present (voice styling comes later; judge substance, not style).
Reply with only JSON matching the schema, no prose.`;

function buildUserPrompt(input: ReviewInput): string {
  return JSON.stringify({
    recipe: {
      title: input.recipe.title,
      servings: input.recipe.nativeServings,
      ingredients: input.recipe.ingredients,
      steps: input.recipe.steps,
      equipment: input.recipe.equipment,
    },
    timeline: input.timeline,
    schedule: {
      tasks: input.schedule.tasks,
      totalMinutes: input.schedule.totalMinutes,
    },
    equipmentProfile: input.equipmentProfile,
  });
}

/**
 * Full review: 5 coded checks plus 7 model judgments in one structured call.
 * Any failed check blocks compile; blockers carry the readable reasons.
 */
export async function review(
  input: ReviewInput,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<ReviewResult> {
  const coded = runCodedReviewChecks(input);
  const judged = await callStructured(
    ReviewJudgmentsSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    { provider: opts.provider, schemaName: REVIEW_SCHEMA_NAME, client: opts.client },
  );
  const byName = new Map<string, { passed: boolean; detail: string }>();
  for (const judgment of judged.data.checks) {
    if (!byName.has(judgment.name)) byName.set(judgment.name, judgment);
  }
  const modeled: ReviewCheck[] = MODEL_JUDGMENT_NAMES.map((name) => {
    const judgment = byName.get(name);
    if (!judgment) {
      return { name, passed: false, detail: "the model did not judge this check", source: "model" as const };
    }
    return { name, passed: judgment.passed, detail: judgment.detail, source: "model" as const };
  });
  const order = new Map(REVIEW_CHECK_ORDER.map((name, i) => [name, i] as const));
  const checks = [...coded, ...modeled].sort(
    (a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99),
  );
  const blockers = checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
  return {
    checks,
    passed: blockers.length === 0,
    blockers,
    usage: judged.usage,
    fallbackUsed: judged.fallbackUsed,
    attempts: judged.attempts,
    rawResponse: judged.rawContent,
  };
}
