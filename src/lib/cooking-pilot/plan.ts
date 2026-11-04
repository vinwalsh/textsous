/** Browser-safe experimental timeline adapter. Presentation metadata never
 * establishes culinary approval; all required placements use the shared solver. */
import { z } from "zod/v3";
import { instructionPartsSchema, isExactInstructionPartition } from "./instruction-display";
import { cookingCardTitleSchema } from "./card-title";
import { scheduleExperimentalProcedure, type ScheduledTask } from "@/lib/cooking-timeline/schedule";
import { MAX_TIMELINE_SECONDS, taskContainmentSchema, type ExperimentalCookingProcedure } from "@/lib/cooking-timeline/types";
import { recipeServingsSchema } from "@/lib/recipe-servings";

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const text = z.string().trim().min(1).max(2000);
/** Longest single task: 12 hours, the open format's MAX_TASK_MINUTES
 * (src/lib/schema/timeline.ts), so a long simmer or braise is one card. */
export const MAX_TASK_MINUTES = 720;
const minutes = z.number().int().min(1).max(MAX_TASK_MINUTES);
// This card projection uses integral CSS grid rows. The general scheduler
// retains second-level precision; subminute procedures need another renderer.
const wait = z.number().int().min(0).max(MAX_TIMELINE_SECONDS).multipleOf(60);
const taskSchema = z.object({
  id, phase: id, label: text, description: text, completionCue: text,
  instructionParts: instructionPartsSchema.optional(),
  // Optional for existing immutable artifacts; new authors provide action,
  // subject and (when needed) destination/purpose from the effective method.
  cardTitle: cookingCardTitleSchema.optional(),
  minutes, range: z.object({ min: minutes, max: minutes }).strict().optional(),
  timingBasis: z.enum(["source", "estimate"]), attention: z.enum(["hands-on", "unattended"]),
  // Instruction-led timer eligibility is independent of planning provenance:
  // a scaled roast can be an estimate and still instruct a timed interval.
  timerEnabledByDefault: z.boolean().optional(),
  timingAdjustment: z.object({
    kind: z.enum(["package", "doneness"]), note: text,
    instructionTemplate: text.refine(value => value.includes("{minutes}"), "An adjustment needs an explicit duration placeholder"),
    completionCue: text,
  }).strict().optional(),
  timingOrigin: z.enum(["stored-method", "stored-scaling-note", "experimental-profile", "planning-estimate"]).optional(),
  adaptations: z.array(z.object({ kind: z.enum(["quantity", "method", "equipment", "timing"]), explanation: text, sourceStepIds: z.array(id).max(200) }).strict()).max(20).optional(),
  // Explicit opt-in for a checked experimental unattended interval. This is
  // planning metadata, never a culinary safety or free-time guarantee.
  allowOptionalWork: z.boolean().optional(),
  laneIds: z.array(id).min(1).max(40), dependencies: z.array(id).max(100), sourceStepIds: z.array(id).max(200),
  editableMinutes: z.boolean().optional(), maxMinutes: minutes.optional(), optional: z.boolean().optional(),
  tip: text.optional(), checkpoints: z.array(z.object({ afterMinutes: minutes, label: text }).strict()).max(20).optional(),
  equipmentEvent: z.enum(["oven-on", "oven-off"]).optional(),
  scheduling: z.object({
    waits: z.array(z.object({ taskId: id, minWaitSeconds: wait, maxWaitSeconds: wait }).strict()).max(100),
    resourceIds: z.array(id).max(32), ingredientIds: z.array(id).max(200),
    optionalWindows: z.array(id).max(100).optional(),
  }).strict(),
}).strict();
export const cookingTimelineDefinitionSchema = z.object({
  kind: z.literal("experimental-pilot"), id, revision: id,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), servings: z.number().positive().max(1000),
  effectiveIdentity: z.string().min(1).max(300).optional(),
  supportedSource: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("base-native-servings"), servings: z.number().int().positive().max(1000) }).strict(),
    z.object({ kind: z.literal("experimental-serving-profile"), nativeServings: z.number().int().positive(),
      servings: recipeServingsSchema.refine(value => value >= 1 && value <= 6), profileId: id }).strict(),
    // Generated candidates carry their own reviewed quantities/equipment and
    // never inherit a curated pilot's narrower supported serving range.
    z.object({ kind: z.literal("generated-serving-profile"), nativeServings: z.number().positive().max(1000),
      servings: recipeServingsSchema, profileId: id }).strict(),
  ]),
  mode: z.literal("fresh"), cookCount: z.literal(1),
  lanes: z.array(z.object({ id, label: text, color: z.string().regex(/^#[a-fA-F0-9]{6}$/), kind: z.enum(["component", "kitchen"]) }).strict()).min(2).max(41),
  phases: z.array(z.object({ id, label: text }).strict()).min(1).max(20),
  phaseStarts: z.array(z.object({ phaseId: id, taskId: id }).strict()).min(1).max(20).optional(),
  tasks: z.array(taskSchema).min(1).max(100),
  resources: z.array(z.object({ id }).strict()).max(32),
  resourceHolds: z.array(z.object({ id, resourceId: id, startTaskId: id, endTaskId: id, taskIds: z.array(id).min(1).max(100) }).strict()).max(100),
  containments: z.array(taskContainmentSchema).max(100).optional(),
  sourceStepIds: z.array(id).min(1).max(200), ingredientIds: z.array(id).min(1).max(200), serveTaskId: id,
}).strict();
export type CookingTimelineDefinition = z.infer<typeof cookingTimelineDefinitionSchema>;
export type CookingTaskDefinition = z.infer<typeof taskSchema>;
export type CookingScheduledTask = CookingTaskDefinition & { startMinute: number; endMinute: number; deferredUntilAfterServing?: boolean; adjustedFromMinutes?: number };
export interface CookingPlan {
  version: string; definitionId: string; sourceFingerprint: string; kind: "experimental-pilot"; servings: number;
  lanes: CookingTimelineDefinition["lanes"]; phases: CookingTimelineDefinition["phases"];
  tasks: CookingScheduledTask[]; serveMinute: number; totalMinutes: number; handsOnMinutes: number;
  resourceHolds: { resourceId: string; startMinute: number; endMinute: number }[];
  containments?: CookingTimelineDefinition["containments"];
  cardTracks: Record<string, { columnStart: number; columnEnd: number }>;
  phaseSpans: { phaseId: string; startMinute: number; endMinute: number }[];
  scheduling: { engine: "shared-constraint-scheduler"; searchNodes: number };
}
export class CookingPlanError extends Error {
  constructor(readonly code: "invalid_definition" | "invalid_override" | "noneditable_task" | "scheduling_refused",
    readonly taskId: string, message: string, readonly maxMinutes?: number) { super(message); this.name = "CookingPlanError"; }
}
const fail = (message: string): never => { throw new CookingPlanError("invalid_definition", "", message); };
const unique = (values: string[]) => new Set(values).size === values.length;

/** Display-only bands for an already solved generated plan. These do not add
 * stage barriers or move work; overlapping or incomplete phases stay unbanded. */
function generatedPhaseSpans(definition: CookingTimelineDefinition, tasks: CookingScheduledTask[], serveMinute: number): CookingPlan["phaseSpans"] {
  if (definition.supportedSource.kind !== "generated-serving-profile") return [];
  const required = tasks.filter(task => !task.optional);
  const spans = definition.phases.map(phase => {
    const members = required.filter(task => task.phase === phase.id);
    return { phaseId: phase.id, startMinute: Math.min(...members.map(task => task.startMinute)),
      endMinute: Math.max(...members.map(task => task.endMinute)) };
  });
  if (spans[0]?.startMinute !== 0 || spans.at(-1)?.endMinute !== serveMinute
    || spans.some((span, index) => !Number.isFinite(span.startMinute) || !Number.isFinite(span.endMinute)
      || span.endMinute <= span.startMinute || (index > 0 && spans[index - 1].endMinute !== span.startMinute))) return [];
  return spans;
}

/** A personalized duration must update one unambiguous full-method step. */
export function timingAdjustmentsMatchMethod(definition: CookingTimelineDefinition, steps: readonly { text: string }[]): boolean {
  return definition.tasks.filter(task => task.timingAdjustment).every(task => !task.optional
    && definition.tasks.filter(other => other.description === task.description).length === 1
    && steps.filter(step => step.text === task.description).length === 1);
}

export function buildCookingPlan(input: CookingTimelineDefinition, overrides: Record<string, number> = {}, options: { validateLayout?: boolean } = {}): CookingPlan {
  const validateLayout = options.validateLayout !== false;
  const parsed = cookingTimelineDefinitionSchema.safeParse(input);
  if (!parsed.success) return fail("The experimental timeline definition is invalid");
  const definition = parsed.data;
  if (definition.servings !== definition.supportedSource.servings) return fail("This timeline only supports its exact native recipe yield or explicit experimental serving profile");
  if (definition.supportedSource.kind !== "base-native-servings" && !definition.effectiveIdentity) return fail("Derived serving profiles require an effective selection identity");
  const all = new Map(definition.tasks.map(task => [task.id, task]));
  const laneIds = definition.lanes.map(lane => lane.id), phaseIds = definition.phases.map(phase => phase.id);
  if (all.size !== definition.tasks.length || !unique(laneIds) || !unique(phaseIds)) return fail("Timeline task, lane and phase IDs must be unique");
  if (validateLayout && definition.lanes.at(-1)?.kind !== "kitchen") return fail("This card layout requires the kitchen lane last");
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) throw new CookingPlanError("invalid_override", "", "Timing estimates must be a task-to-minutes object");
  for (const [taskId, value] of Object.entries(overrides)) {
    const task = all.get(taskId);
    if (!task?.editableMinutes || (task.timingBasis !== "estimate" && !task.timingAdjustment)) throw new CookingPlanError("noneditable_task", taskId, "Only explicitly editable estimates or marked cooking times can change");
    const max = task.maxMinutes ?? MAX_TASK_MINUTES;
    if (!Number.isInteger(value) || value < 1 || value > max) throw new CookingPlanError("invalid_override", taskId, `Choose a whole number from 1 to ${max} minutes`, max);
  }
  const adjustedFrom = new Map<string, number>();
  for (const task of definition.tasks) {
    if (task.timingAdjustment && !task.editableMinutes) return fail(`A marked cooking-time adjustment must be editable: ${task.id}`);
    if (task.timingAdjustment && (task.optional || definition.tasks.some(other => other.id !== task.id && other.description === task.description))) return fail(`A marked cooking-time adjustment needs a unique required instruction: ${task.id}`);
    if (Object.hasOwn(overrides, task.id) && overrides[task.id] !== task.minutes) {
      adjustedFrom.set(task.id, task.minutes);
      task.minutes = overrides[task.id];
      if (task.timingAdjustment) {
        task.description = task.timingAdjustment.instructionTemplate.replaceAll("{minutes}", String(task.minutes));
        task.completionCue = task.timingAdjustment.completionCue;
        if (!isExactInstructionPartition(task.description, task.instructionParts)) delete task.instructionParts;
        task.range = undefined;
        // Keep early food checks when possible; an earlier finish still needs
        // the same checks. Never leave a checkpoint beyond the revised step.
        if (task.checkpoints) {
          const checks = new Map<number, Set<string>>();
          for (const point of task.checkpoints) {
            const minute = Math.min(point.afterMinutes, task.minutes);
            const labels = checks.get(minute) ?? new Set<string>();
            labels.add(point.label);
            checks.set(minute, labels);
          }
          task.checkpoints = [...checks].map(([afterMinutes, labels]) => ({ afterMinutes, label: [...labels].join(" ") }));
        }
      }
    }
    if (!phaseIds.includes(task.phase) || !unique(task.laneIds) || task.laneIds.some(lane => !laneIds.includes(lane))) return fail(`Invalid presentation references: ${task.id}`);
    const indices = task.laneIds.map(id => laneIds.indexOf(id));
    if (validateLayout && indices.some((value, index) => index > 0 && value !== indices[index - 1] + 1)) return fail(`Shared card lanes must be ordered and contiguous: ${task.id}`);
    if (task.minutes > (task.maxMinutes ?? MAX_TASK_MINUTES) || (task.editableMinutes && task.timingBasis !== "estimate" && !task.timingAdjustment)) return fail(`Unsupported duration definition: ${task.id}`);
    if (task.range && (task.range.min > task.minutes || task.range.max !== task.minutes)) return fail(`Source range must retain its conservative maximum: ${task.id}`);
    if (task.checkpoints?.some(point => point.afterMinutes > task.minutes)) return fail(`Checkpoint exceeds task duration: ${task.id}`);
    if (task.checkpoints?.some((point, index, all) => index > 0 && point.afterMinutes <= all[index - 1].afterMinutes)) return fail(`Checkpoints must be ordered and distinct: ${task.id}`);
    if (!unique(task.dependencies) || task.dependencies.some(id => !all.has(id) || all.get(id)!.optional)) return fail(`Invalid required predecessor: ${task.id}`);
    if (task.optional && task.attention !== "hands-on") return fail("Optional placement currently supports hands-on kitchen work only");
    const waits = task.scheduling.waits;
    if (!unique(waits.map(item => item.taskId)) || waits.length !== task.dependencies.length
      || waits.some(item => !task.dependencies.includes(item.taskId) || item.minWaitSeconds > item.maxWaitSeconds)) return fail(`Every predecessor requires an explicit wait bound: ${task.id}`);
    if (task.scheduling.resourceIds.some(id => !definition.resources.some(resource => resource.id === id))) return fail(`Unknown resource: ${task.id}`);
    if (!unique(task.scheduling.resourceIds) || task.sourceStepIds.some(id => !definition.sourceStepIds.includes(id))
      || task.scheduling.ingredientIds.some(id => !definition.ingredientIds.includes(id))) return fail(`Unknown or repeated task source/resource references: ${task.id}`);
    if (task.adaptations?.some(change => change.sourceStepIds.some(id => !definition.sourceStepIds.includes(id)))) return fail(`Unknown adaptation source: ${task.id}`);
    if (task.allowOptionalWork && (task.attention !== "unattended" || !task.checkpoints?.length)) return fail(`Experimental optional-work windows require explicit checks: ${task.id}`);
    if (task.optional && task.laneIds.some(id => definition.lanes.find(lane => lane.id === id)!.kind !== "kitchen")) return fail("Optional work cannot silently substitute for required food preparation");
  }
  const required = definition.tasks.filter(task => !task.optional);
  const procedure: ExperimentalCookingProcedure = {
    version: 1, kind: "experimental-pilot", revision: 1, id: definition.id, sourceFingerprint: definition.sourceFingerprint,
    servings: definition.servings, cookCount: 1, mode: "fresh",
    components: definition.lanes.filter(lane => lane.kind === "component").map(lane => ({ id: lane.id })),
    lanes: definition.lanes.map(lane => lane.kind === "kitchen" ? { id: lane.id, kind: "kitchen" } : { id: lane.id, kind: "component", componentId: lane.id }),
    resources: definition.resources, resourceHolds: definition.resourceHolds, ...(definition.containments ? { containments: definition.containments } : {}), serveTaskId: definition.serveTaskId,
    tasks: required.map(task => ({ id: task.id, laneId: task.laneIds[0], participatingLaneIds: task.laneIds, kind: task.id === definition.serveTaskId ? "serve" : "work",
      label: task.label, instruction: task.description, completionCue: task.completionCue, attention: task.attention,
      duration: { minSeconds: (task.range?.min ?? task.minutes) * 60, estimateSeconds: task.minutes * 60, maxSeconds: task.minutes * 60 },
      dependencies: task.scheduling.waits, resourceIds: task.scheduling.resourceIds, sourceStepIds: task.sourceStepIds, ingredientIds: task.scheduling.ingredientIds,
    })),
  };
  const schedule = scheduleExperimentalProcedure(procedure, {
    sourceFingerprint: definition.sourceFingerprint, servings: definition.servings,
    availableResourceIds: definition.resources.map(resource => resource.id), sourceStepIds: definition.sourceStepIds, ingredientIds: definition.ingredientIds,
  });
  if (!schedule.ok) throw new CookingPlanError("scheduling_refused", "", schedule.message);
  if (schedule.tasks.some(task => task.startSec % 60 !== 0 || task.endSec % 60 !== 0)) return fail("This card layout requires minute-aligned task placements");
  const placements = new Map(schedule.tasks.map(task => [task.id, task]));
  const shifted = (seconds: number) => (seconds + schedule.elapsedSec) / 60;
  const tasks: CookingScheduledTask[] = required.map(task => ({ ...task, ...(adjustedFrom.has(task.id) ? { adjustedFromMinutes: adjustedFrom.get(task.id) } : {}), startMinute: shifted(placements.get(task.id)!.startSec), endMinute: shifted(placements.get(task.id)!.endSec) }));
  const holds = definition.resourceHolds.map(hold => ({ resourceId: hold.resourceId,
    startSec: placements.get(hold.startTaskId)!.startSec, endSec: placements.get(hold.endTaskId)!.endSec }));
  const optionalPlacements: (ScheduledTask & { resourceIds: string[] })[] = [];
  for (const task of definition.tasks.filter(task => task.optional)) {
    const duration = task.minutes * 60;
    const after = Math.max(-schedule.elapsedSec, ...task.scheduling.waits.map(wait => placements.get(wait.taskId)!.endSec + wait.minWaitSeconds));
    const latestStart = Math.min(MAX_TIMELINE_SECONDS, ...task.scheduling.waits.map(wait => placements.get(wait.taskId)!.endSec + wait.maxWaitSeconds));
    const windows = (task.scheduling.optionalWindows ?? []).map(id => {
      const target = all.get(id), placement = placements.get(id);
      if (!target || !placement || target.optional || target.attention !== "unattended" || (target.timingBasis !== "source" && !target.allowOptionalWork)) return fail(`Unsupported optional-work window: ${id}`);
      return { startSec: Math.max(after, placement.startSec), endSec: placement.startSec + Math.min(target.minutes, ...(target.checkpoints ?? []).map(point => point.afterMinutes)) * 60 };
    }).sort((a, b) => a.startSec - b.startSec);
    const blocked = [
      ...schedule.tasks.filter(item => task.scheduling.resourceIds.some(id => all.get(item.id)!.scheduling.resourceIds.includes(id))),
      ...holds.filter(hold => task.scheduling.resourceIds.includes(hold.resourceId)),
      ...optionalPlacements,
    ];
    let start: number | undefined;
    for (const window of windows) {
      for (const free of schedule.freeAttentionIntervals) {
        const end = Math.min(window.endSec, free.endSec, latestStart + duration);
        let candidate = Math.max(window.startSec, free.startSec);
        for (const occupied of [...blocked].sort((a, b) => a.startSec - b.startSec)) {
          if (candidate + duration <= occupied.startSec || candidate >= occupied.endSec) continue;
          candidate = occupied.endSec;
        }
        if (candidate + duration <= end) { start = candidate; break; }
      }
      if (start !== undefined) break;
    }
    const deferred = start === undefined;
    if (start === undefined) start = Math.max(0, after, ...optionalPlacements.map(item => item.endSec));
    if (start > latestStart || start + duration + schedule.elapsedSec > MAX_TIMELINE_SECONDS) return fail(`Optional work cannot fit its explicit wait bounds or display horizon: ${task.id}`);
    const placement = { id: task.id, startSec: start, endSec: start + duration, resourceIds: task.scheduling.resourceIds };
    optionalPlacements.push(placement);
    tasks.push({ ...task, startMinute: shifted(start), endMinute: shifted(placement.endSec), ...(deferred ? { deferredUntilAfterServing: true } : {}) });
  }
  tasks.sort((a, b) => a.startMinute - b.startMinute || definition.tasks.findIndex(task => task.id === a.id) - definition.tasks.findIndex(task => task.id === b.id));
  // This bounded display supports a shared card plus a single concurrent
  // task in its final lane. Refuse other collisions instead of painting one
  // valid cooking interval over another; a fuller packing renderer is later.
  const overlaps = (a: CookingScheduledTask, b: CookingScheduledTask) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;
  const cardTracks: CookingPlan["cardTracks"] = validateLayout ? Object.fromEntries(tasks.map(task => {
    const concurrent = tasks.filter(other => other.id !== task.id && overlaps(task, other));
    const shareLast = task.laneIds.length > 1 && concurrent.some(other => other.laneIds.length === 1 && other.laneIds[0] === task.laneIds.at(-1));
    const secondTrack = task.laneIds.length === 1 && concurrent.some(other => other.laneIds.length > 1 && other.laneIds.at(-1) === task.laneIds[0]);
    return [task.id, { columnStart: laneIds.indexOf(task.laneIds[0]) * 2 + 2 + (secondTrack ? 1 : 0),
      columnEnd: (laneIds.indexOf(task.laneIds.at(-1)!) + 1) * 2 + 2 - (shareLast ? 1 : 0) }];
  })) : {};
  if (validateLayout) for (let i = 0; i < tasks.length; i++) for (const other of tasks.slice(i + 1)) {
    const a = cardTracks[tasks[i].id], b = cardTracks[other.id];
    if (overlaps(tasks[i], other) && a.columnStart < b.columnEnd && b.columnStart < a.columnEnd) return fail(`This card layout cannot display overlapping tracks: ${tasks[i].id}, ${other.id}`);
  }
  let phaseSpans = (definition.phaseStarts ?? []).map((stage, index, stages) => {
    const start = tasks.find(task => task.id === stage.taskId);
    const next = index + 1 < stages.length ? tasks.find(task => task.id === stages[index + 1].taskId) : undefined;
    if (!phaseIds.includes(stage.phaseId) || !start || start.optional || (index + 1 < stages.length && (!next || next.optional))) return fail("Stage anchors must reference required tasks and known phases");
    return { phaseId: stage.phaseId, startMinute: start.startMinute, endMinute: next?.startMinute ?? schedule.elapsedSec / 60 };
  });
  if (phaseSpans.length) {
    if (!unique(phaseSpans.map(stage => stage.phaseId)) || phaseSpans[0].startMinute !== 0
      || phaseSpans.some(stage => stage.endMinute <= stage.startMinute)) return fail("Stages must be ordered, distinct and cover the required cooking plan");
    for (const task of tasks.filter(task => !task.optional)) {
      const stage = phaseSpans.find(stage => stage.phaseId === task.phase);
      if (!stage || task.startMinute < stage.startMinute || task.endMinute > stage.endMinute) return fail(`Required work falls outside its declared stage: ${task.id}`);
    }
    if (tasks.some(task => phaseSpans.some(stage => task.startMinute < stage.startMinute && task.endMinute > stage.startMinute))) return fail("A task cannot cross a displayed stage boundary");
  }
  if (!definition.phaseStarts) phaseSpans = generatedPhaseSpans(definition, tasks, schedule.elapsedSec / 60);
  return { version: definition.revision, definitionId: definition.id, sourceFingerprint: definition.sourceFingerprint, kind: "experimental-pilot", servings: definition.servings,
    lanes: definition.lanes, phases: definition.phases, tasks, cardTracks, phaseSpans, serveMinute: schedule.elapsedSec / 60,
    totalMinutes: Math.max(...tasks.map(task => task.endMinute)), handsOnMinutes: tasks.filter(task => task.attention === "hands-on").reduce((sum, task) => sum + task.minutes, 0),
    resourceHolds: holds.map(hold => ({ resourceId: hold.resourceId, startMinute: shifted(hold.startSec), endMinute: shifted(hold.endSec) })),
    ...(definition.containments ? { containments: definition.containments } : {}),
    scheduling: { engine: "shared-constraint-scheduler", searchNodes: schedule.searchNodes },
  };
}
