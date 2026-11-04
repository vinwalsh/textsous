import { z } from "zod/v3";

/** Deliberately bounded, static, single-cook procedures. */
export const MAX_TASKS = 100;
export const MAX_TIMELINE_SECONDS = 24 * 60 * 60;

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const seconds = z.number().int().min(0).max(MAX_TIMELINE_SECONDS);
const sourceIds = z.array(id).max(200);
// Validate display text without rewriting the supplied wording or whitespace.
const displayText = (maximum: number) => z.string().min(1).max(maximum).refine(
  value => value.trim().length > 0, { message: "Display text must not be blank" },
);

export const durationRangeSchema = z.object({
  minSeconds: seconds.min(1),
  estimateSeconds: seconds.min(1),
  maxSeconds: seconds.min(1),
}).strict().refine(
  value => value.minSeconds <= value.estimateSeconds && value.estimateSeconds <= value.maxSeconds,
  { message: "Duration must satisfy 0 < minSeconds <= estimateSeconds <= maxSeconds" },
);

export const cookingTaskSchema = z.object({
  id,
  label: displayText(160),
  instruction: displayText(2000),
  completionCue: displayText(500),
  laneId: id,
  // Explicit shared-card participation does not change primary ownership or
  // create equipment occupancy. Omission preserves legacy single-lane tasks.
  participatingLaneIds: z.array(id).min(1).max(41).optional(),
  kind: z.enum(["work", "serve"]),
  // An intermittent task must be split into explicit work/check/wait tasks.
  attention: z.enum(["hands-on", "unattended"]),
  duration: durationRangeSchema,
  dependencies: z.array(z.object({
    taskId: id,
    // Predecessor END to this task's START; no implicit unlimited wait.
    minWaitSeconds: seconds,
    maxWaitSeconds: seconds,
  }).strict().refine(value => value.minWaitSeconds <= value.maxWaitSeconds, {
    message: "Minimum wait must not exceed maximum wait",
  })).max(MAX_TASKS),
  resourceIds: z.array(id).max(32),
  // Multiple atomic tasks may refer to the same source step or ingredient.
  sourceStepIds: sourceIds,
  ingredientIds: sourceIds,
}).strict();

export const resourceHoldSchema = z.object({
  id,
  resourceId: id,
  // Continuous occupancy, startTask START through endTask END (inclusive).
  startTaskId: id,
  endTaskId: id,
  // Explicit ownership: unrelated tasks cannot use an occupied resource.
  taskIds: z.array(id).min(1).max(MAX_TASKS),
}).strict();

/** A complete activity occurs inside another actual task interval. This is
 * independent of end-to-start prerequisites; neither endpoint is a fake rest. */
export const taskContainmentSchema = z.object({ processTaskId: id, activityTaskId: id }).strict();

export const cookingProcedureSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().positive(),
  id,
  sourceFingerprint: fingerprint,
  servings: z.number().finite().positive(),
  cookCount: z.literal(1),
  mode: z.literal("fresh"),
  // An attestation supplied by an authorized operator, NOT authorization.
  // This schema does not establish who reviewed the culinary content.
  review: z.object({
    status: z.literal("reviewed"),
    reviewedBy: z.string().trim().min(1).max(200),
    reviewedAt: z.string().datetime({ offset: true }),
    evidence: z.string().trim().min(1).max(2000),
  }).strict(),
  components: z.array(z.object({ id }).strict()).min(1).max(40),
  lanes: z.array(z.discriminatedUnion("kind", [
    z.object({ id, kind: z.literal("component"), componentId: id }).strict(),
    z.object({ id, kind: z.literal("kitchen") }).strict(),
  ])).min(2).max(41),
  // Each named resource is exclusive; capacity is represented by distinct IDs.
  resources: z.array(z.object({ id }).strict()).max(32),
  tasks: z.array(cookingTaskSchema).min(1).max(MAX_TASKS),
  resourceHolds: z.array(resourceHoldSchema).max(100),
  containments: z.array(taskContainmentSchema).max(100).optional(),
  serveTaskId: id,
}).strict();

export const validationContextSchema = z.object({
  sourceFingerprint: fingerprint,
  servings: z.number().finite().positive(),
  availableResourceIds: z.array(id).max(32),
  // Trusted source inventory supplied independently of the submitted graph.
  sourceStepIds: sourceIds.min(1),
  ingredientIds: sourceIds.min(1),
}).strict();

export type DurationRange = z.infer<typeof durationRangeSchema>;
export type CookingTask = z.infer<typeof cookingTaskSchema>;
export type ResourceHold = z.infer<typeof resourceHoldSchema>;
export type CookingProcedure = z.infer<typeof cookingProcedureSchema>;
/** Separate experimental boundary: it cannot satisfy the reviewed schema.
 * Used only by an explicitly labeled, curated pilot, never recipe approval. */
export const experimentalCookingProcedureSchema = cookingProcedureSchema.omit({ review: true }).extend({
  kind: z.literal("experimental-pilot"),
}).strict();
export type ExperimentalCookingProcedure = z.infer<typeof experimentalCookingProcedureSchema>;
export type SchedulingProcedure = Omit<CookingProcedure, "review">;
export type ValidationContext = z.infer<typeof validationContextSchema>;

export type ValidationIssueCode =
  | "schema"
  | "context"
  | "duplicate_id"
  | "missing_reference"
  | "stale_source"
  | "servings_mismatch"
  | "unavailable_resource"
  | "coverage"
  | "cycle"
  | "orphan"
  | "resource_hold"
  | "containment"
  | "unsupported";

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: string;
  message: string;
}

export type ProcedureValidationResult =
  | { ok: true; procedure: CookingProcedure }
  | { ok: false; issues: ValidationIssue[] };
