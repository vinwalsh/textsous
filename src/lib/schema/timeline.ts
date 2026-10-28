import { z } from "zod";
import { toResponseJsonSchema } from "./json";

export const LaneKindSchema = z.enum(["component", "kitchen"]);
export const TimelinePhaseSchema = z.enum(["prep", "cook", "finish"]);
export const TimingBasisSchema = z.enum(["source", "estimate"]);
export const AttentionSchema = z.enum(["hands-on", "unattended"]);
export const EquipmentEventSchema = z.enum(["oven-on", "oven-off"]);

export const LaneSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  kind: LaneKindSchema,
});

export const CardTitleSchema = z.strictObject({
  action: z.string().min(1),
  subject: z.string().min(1),
  context: z.string(),
});

export const TaskRangeSchema = z.strictObject({
  low: z.number().int().min(1).max(180),
  high: z.number().int().min(1).max(180),
});

export const TaskSchedulingSchema = z.strictObject({
  // Wait seconds before the task; multiples of 60 enforced by review, not here.
  waits: z.array(z.number().int().min(0)),
  resourceIds: z.array(z.string().min(1)),
  ingredientIds: z.array(z.string().min(1)),
});

export const TimelineTaskSchema = z.strictObject({
  id: z.string().min(1),
  phase: TimelinePhaseSchema,
  label: z.string().min(1),
  cardTitle: CardTitleSchema,
  description: z.string().min(1),
  completionCue: z.string().min(1),
  minutes: z.number().int().min(1).max(180),
  range: TaskRangeSchema.nullish(),
  timingBasis: TimingBasisSchema,
  // Exactly one verbatim source quote when timingBasis is "source", else null.
  sourceQuote: z.string().nullish(),
  attention: AttentionSchema,
  timerEnabledByDefault: z.boolean(),
  laneIds: z.array(z.string().min(1)).min(1),
  dependencies: z.array(z.string().min(1)),
  // Every timeline task cites its source steps: at least one, enforced here.
  sourceStepIds: z.array(z.string().min(1)).min(1),
  checkpoints: z.array(z.string().min(1)),
  tip: z.string().nullish(),
  equipmentEvent: EquipmentEventSchema.nullish(),
  scheduling: TaskSchedulingSchema,
});

export const TimelineResourceSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  // Free text (pan, burner, oven, ...): the spec gives examples, not a closed set.
  kind: z.string().min(1),
});

export const ResourceHoldSchema = z.strictObject({
  taskId: z.string().min(1),
  resourceId: z.string().min(1),
});

export const TimelineDefinitionSchema = z.strictObject({
  // Kitchen lane last and waits in multiples of 60 s are checked by the
  // review stage (M2.4): the schema stays free of refinements so it converts
  // cleanly to JSON Schema.
  lanes: z.array(LaneSchema).min(1),
  tasks: z.array(TimelineTaskSchema).min(1),
  resources: z.array(TimelineResourceSchema),
  resourceHolds: z.array(ResourceHoldSchema),
  serveTaskId: z.string().min(1),
});

export type Lane = z.infer<typeof LaneSchema>;
export type TimelineTask = z.infer<typeof TimelineTaskSchema>;
export type TimelineResource = z.infer<typeof TimelineResourceSchema>;
export type ResourceHold = z.infer<typeof ResourceHoldSchema>;
export type TimelineDefinition = z.infer<typeof TimelineDefinitionSchema>;

export const TIMELINE_SCHEMA_NAME = "timeline_definition_v1";

/** Inlined JSON Schema (no $ref) for response_format. */
export function timelineResponseJsonSchema(): Record<string, unknown> {
  return toResponseJsonSchema(TimelineDefinitionSchema);
}
