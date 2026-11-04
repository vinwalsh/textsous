/** Browser-local timing preferences, independent of a single cooking session.
 * These keys express local equality, never culinary approval or authorization. */
import { z } from "zod/v3";
import { cookingContentIdentity } from "./effective-method";
import { buildCookingPlan, CookingPlanError, cookingTimelineDefinitionSchema, MAX_TASK_MINUTES, type CookingTimelineDefinition } from "./plan";
import { buildTaskTimerPresets, hasRunningTimelineTimers, parseStoredTimelineSession,
  syncTaskTimerPresets, type TimelineSession } from "./timeline-session";

export const MAX_TIMING_PREFERENCES_LENGTH = 50_000;
const taskId = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const overridesSchema = z.record(taskId, z.number().int().min(1).max(MAX_TASK_MINUTES))
  .refine(value => Object.keys(value).length <= 100);
const contextSchema = z.object({
  recipeId: z.string().min(1).max(300).refine(value => value.trim().length > 0),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  definitionIdentity: z.string().regex(/^display-[a-f0-9]{32}$/),
}).strict();
const storedSchema = z.object({ version: z.literal(1), context: contextSchema, overrides: overridesSchema }).strict();

export type TimingPreferenceContext = z.infer<typeof contextSchema>;
export type TimingPreferencesResult =
  | { status: "ready"; overrides: Record<string, number> }
  | { status: "empty" | "stale" | "invalid" | "infeasible"; overrides: null };
export interface AppliedTimingPreferences {
  status: "applied" | "unchanged" | "blocked" | "invalid" | "infeasible";
  session: TimelineSession;
}

export function timingPreferenceContext(recipeId: string, sourceFingerprint: string,
  definition: CookingTimelineDefinition): TimingPreferenceContext {
  if (!cookingTimelineDefinitionSchema.safeParse(definition).success || sourceFingerprint !== definition.sourceFingerprint) {
    throw new Error("Timing preferences require the exact recipe source and definition");
  }
  return contextSchema.parse({ recipeId, sourceFingerprint, definitionIdentity: cookingContentIdentity(definition) });
}

/** Source/profile/revision/instruction/resource changes receive another key.
 * The complete context is also inside the value, so a copied value is refused. */
export function timingPreferencesStorageKey(context: TimingPreferenceContext): string {
  const parsed = contextSchema.parse(context);
  return `sous:cooking-timing-preferences:v1:${encodeURIComponent(parsed.recipeId)}:${parsed.sourceFingerprint}:${parsed.definitionIdentity}`;
}

function sameContext(left: TimingPreferenceContext, right: TimingPreferenceContext): boolean {
  return left.recipeId === right.recipeId && left.sourceFingerprint === right.sourceFingerprint
    && left.definitionIdentity === right.definitionIdentity;
}

function matchesDefinition(context: TimingPreferenceContext, definition: CookingTimelineDefinition): boolean {
  try { return sameContext(contextSchema.parse(context), timingPreferenceContext(context.recipeId, context.sourceFingerprint, definition)); }
  catch { return false; }
}

function validateOverrides(overrides: unknown, definition: CookingTimelineDefinition):
  { status: "ready"; overrides: Record<string, number> } | { status: "invalid" | "infeasible"; overrides: null } {
  const parsed = overridesSchema.safeParse(overrides);
  if (!parsed.success) return { status: "invalid", overrides: null };
  // A bad baseline is not a saved-preference conflict.
  try { buildCookingPlan(definition); }
  catch { return { status: "invalid", overrides: null }; }
  try {
    buildCookingPlan(definition, parsed.data);
    return { status: "ready", overrides: parsed.data };
  } catch (error) {
    return { status: error instanceof CookingPlanError && (error.code === "invalid_override" || error.code === "noneditable_task")
      ? "invalid" : "infeasible", overrides: null };
  }
}

export function parseTimingPreferences(raw: string | null, context: TimingPreferenceContext,
  definition: CookingTimelineDefinition): TimingPreferencesResult {
  if (!matchesDefinition(context, definition)) return { status: "invalid", overrides: null };
  if (raw === null) return { status: "empty", overrides: null };
  if (raw.length > MAX_TIMING_PREFERENCES_LENGTH) return { status: "invalid", overrides: null };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return { status: "invalid", overrides: null }; }
  const parsed = storedSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", overrides: null };
  if (!sameContext(parsed.data.context, context)) return { status: "stale", overrides: null };
  return validateOverrides(parsed.data.overrides, definition);
}

/** Only accepted whole-plan edits should reach storage. Throws before a caller
 * writes anything if the map is stale, noneditable, out of bounds or infeasible. */
export function serializeTimingPreferences(overrides: Record<string, number>, context: TimingPreferenceContext,
  definition: CookingTimelineDefinition): string {
  if (!matchesDefinition(context, definition)) throw new Error("Timing preference context does not match this definition");
  const checked = validateOverrides(overrides, definition);
  if (checked.status !== "ready") throw new Error(`Timing preferences are ${checked.status}`);
  const raw = JSON.stringify({ version: 1, context, overrides: checked.overrides });
  if (raw.length > MAX_TIMING_PREFERENCES_LENGTH) throw new Error("Timing preferences exceed their storage limit");
  return raw;
}

/** Existing session choices win over preferences. Applying before a fresh cook
 * never advances timestamps, starts a clock, resets observations or configures
 * a timer the cook already changed/used. Running earlier timers also block it. */
export function applySavedTimingPreferences(session: TimelineSession, overrides: Record<string, number>,
  definition: CookingTimelineDefinition): AppliedTimingPreferences {
  if (!cookingTimelineDefinitionSchema.safeParse(definition).success) return { status: "invalid", session };
  const lanes = definition.lanes.map(lane => lane.id);
  try {
    const checked = parseStoredTimelineSession(JSON.stringify(session), {
      sourceIdentity: definition.sourceFingerprint, planIdentity: definition.revision,
    }, definition.tasks, lanes);
    if (checked.status !== "restored") return { status: "invalid", session };
  } catch { return { status: "invalid", session }; }
  if (session.guidance.startedAtMs !== null || hasRunningTimelineTimers(session)) return { status: "blocked", session };
  const saved = validateOverrides(overrides, definition);
  if (saved.status !== "ready") return { status: saved.status, session };
  const merged = { ...saved.overrides, ...session.timingOverrides };
  const checked = validateOverrides(merged, definition);
  if (checked.status !== "ready") return { status: checked.status, session };
  if (cookingContentIdentity(merged) === cookingContentIdentity(session.timingOverrides)) return { status: "unchanged", session };
  try {
    const plan = buildCookingPlan(definition, merged);
    const next = syncTaskTimerPresets({ ...session, timingOverrides: merged }, buildTaskTimerPresets(plan), definition.tasks, lanes);
    return { status: "applied", session: next };
  } catch { return { status: "invalid", session }; }
}
