/**
 * Open Cook Along artifact -> the Cook Along view's recipe and timeline
 * definition. Pure and synchronous (browser, server and tests).
 *
 * The open format's scheduling rules are carried over as explicit
 * constraints, so the view's scheduler honors them:
 * - waits: seconds after the last dependency ends, or after the preheat for
 *   the oven heat-up (readyAfter in src/lib/scheduler/schedule.ts), become a
 *   minimum wait on each dependency the open scheduler counts it from;
 * - every prep task ends before the first cook task starts, and the serve
 *   task starts after every other task ends: added as dependencies;
 * - resource holds occupy the resource for the task, like resourceIds.
 * A range keeps both ends: the task runs to its high end (the view's
 * conservative estimate) and may finish from its low end. Checkpoints
 * (observable cues, no times in the open format) become one check at the
 * range's low end; a task without a range gets them in its tip as
 * "Watch for: ...", never as a check timed at its end.
 */
import type { CookingPilotRecipe } from "@/components/cooking-pilot/cooking-pilot";
import { rollUpTraces } from "@/lib/allergens";
import { laneDisplayColors } from "@/lib/lane-palette";
import { roundRecipeServings } from "@/lib/recipe-servings";
import { formatQuantityWithUnit } from "@/lib/scaling/units";
import type { CookAlongArtifact } from "@/lib/schema/artifact";
import type { TimelineTask } from "@/lib/schema/timeline";
import { MAX_TIMELINE_SECONDS } from "@/lib/cooking-timeline/types";
import { buildCookingPlan, cookingTimelineDefinitionSchema, type CookingTaskDefinition, type CookingTimelineDefinition } from "./plan";
import { sha256Hex } from "./sha256";

export interface CookingPilotInput {
  recipe: CookingPilotRecipe;
  timelineDefinition: CookingTimelineDefinition;
  /** Minutes to serve on the view's own schedule (set by cookingPilotInput), so the page shows one total time. */
  serveMinute?: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PHASE_LABELS: Record<TimelineTask["phase"], string> = {
  prep: "Mise en Place",
  cook: "Cooking",
  finish: "Finish & serve",
};
const PHASE_ORDER: TimelineTask["phase"][] = ["prep", "cook", "finish"];
// Text limits of the view's scheduler (src/lib/cooking-timeline/types.ts).
const LABEL_MAX = 160;
const INSTRUCTION_MAX = 2000;
const CUE_MAX = 500;

/** Ids the view accepts, one-to-one: unsafe characters become "-", clashes get a suffix. */
class IdMap {
  private readonly ids = new Map<string, string>();
  private readonly used = new Set<string>();
  constructor(private readonly prefix: string) {}
  get(raw: string): string {
    const known = this.ids.get(raw);
    if (known !== undefined) return known;
    let base = raw.trim().replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 90);
    if (!ID_PATTERN.test(base)) base = `${this.prefix}${base}`.replace(/^[^A-Za-z0-9]+/, this.prefix).slice(0, 90);
    if (!ID_PATTERN.test(base)) base = this.prefix.replace(/-$/, "") || "id";
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    this.ids.set(raw, id);
    return id;
  }
}

const unique = <T,>(values: Iterable<T>): T[] => [...new Set(values)];
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const minuteSeconds = (seconds: number) => Math.ceil(Math.max(0, seconds) / 60) * 60;

/** Stable 64-hex fingerprint of everything the view shows, so any change starts a fresh cook. */
export function artifactFingerprint(artifact: CookAlongArtifact): string {
  return sha256Hex(JSON.stringify({ id: artifact.id, recipe: artifact.recipe, timeline: artifact.timelineDefinition }));
}

function cardTitle(task: TimelineTask): CookingTaskDefinition["cardTitle"] {
  const action = task.cardTitle.action.trim();
  const subject = task.cardTitle.subject.trim();
  const context = task.cardTitle.context.trim();
  if (!action || !subject || action.length > 60 || subject.length > 120 || context.length > 160) return undefined;
  return context ? { action, subject, context } : { action, subject };
}

/** A sentence: capitalized and ended, so joined cues and tips do not read as one run-on line. */
function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?…]["'”’)\]]*$/.test(capital) ? capital : `${capital}.`;
}

/** The view's timing for a task: a range runs to its high end and may finish from its low end. */
function taskTiming(task: TimelineTask): { minutes: number; range?: { min: number; max: number } } {
  return task.range && task.range.low < task.range.high
    ? { minutes: task.range.high, range: { min: task.range.low, max: task.range.high } }
    : { minutes: task.minutes };
}

/** The task's checkpoints as sentences, joined ("" when it has none). */
function cues(task: TimelineTask): string {
  return task.checkpoints.map((label) => label.trim()).filter(Boolean).map(sentence).join(" ");
}

/** The most component lanes whose orders are searched (7! = 5040 orders). */
const MAX_ORDERED_LANES = 7;

/**
 * Component lanes in an order that keeps every shared step's lanes side by
 * side, with the kitchen lane last: the timeline's own order when it does,
 * else the first that does, in order of the original positions (so lanes
 * move as little as they can). Null when none does (or there are too many
 * lanes to search): a shared step then spans the lanes between.
 */
export function adjacentLaneOrder(components: readonly string[], kitchenId: string, groups: readonly (readonly string[])[]): string[] | null {
  const shared = groups.map((ids) => unique(ids)).filter((ids) => ids.length > 1);
  const fits = (order: readonly string[]) => {
    const at = new Map([...order, kitchenId].map((id, index) => [id, index] as const));
    return shared.every((ids) => {
      const positions = ids.map((id) => at.get(id) ?? -1);
      return !positions.includes(-1) && Math.max(...positions) - Math.min(...positions) === ids.length - 1;
    });
  };
  if (fits(components)) return [...components];
  if (components.length > MAX_ORDERED_LANES) return null;
  const order: string[] = [];
  const left = [...components];
  const search = (): boolean => {
    if (left.length === 0) return fits(order);
    for (let index = 0; index < left.length; index++) {
      const [id] = left.splice(index, 1);
      order.push(id);
      if (search()) return true;
      order.pop();
      left.splice(index, 0, id);
    }
    return false;
  };
  return search() ? order : null;
}

/**
 * Adapt an artifact. Throws when it cannot be expressed (for example a
 * recipe with no lanes the view can draw); callers fall back to the open
 * sections. The result has not been scheduled yet: see cookingPilotInput.
 */
export function adaptArtifactForCookingPilot(artifact: CookAlongArtifact): CookingPilotInput {
  const { recipe } = artifact;
  const timeline = artifact.timelineDefinition;
  const fingerprint = artifactFingerprint(artifact);
  const effectiveIdentity = `open-${fingerprint.slice(0, 32)}`;
  const servings = roundRecipeServings(recipe.servings);

  const taskIds = new IdMap("task-");
  const laneIds = new IdMap("lane-");
  const resourceIds = new IdMap("resource-");
  const stepIds = new IdMap("step-");
  const ingredientIds = new IdMap("ingredient-");

  const openTasks = timeline.tasks;
  const byOpenId = new Map(openTasks.map((task) => [task.id, task] as const));
  const serve = byOpenId.get(timeline.serveTaskId);
  if (!serve) throw new Error("The timeline's serve task is missing");

  // Lanes: only lanes with a task (the view draws no empty lanes), exactly
  // one kitchen lane, last. Without one, serving moves to a new kitchen lane.
  const laneOf = new Map(openTasks.map((task) => [task.id, unique(task.laneIds)] as const));
  let lanes = timeline.lanes.filter((lane, index, all) => all.findIndex((other) => other.id === lane.id) === index);
  const usedLanes = () => new Set([...laneOf.values()].flat());
  lanes = lanes.filter((lane) => usedLanes().has(lane.id));
  let kitchens = lanes.filter((lane) => lane.kind === "kitchen");
  if (kitchens.length === 0) {
    const kitchenId = lanes.some((lane) => lane.id === "kitchen") ? "kitchen-lane" : "kitchen";
    laneOf.set(serve.id, [kitchenId]);
    const stillUsed = usedLanes();
    lanes = [...lanes.filter((lane) => stillUsed.has(lane.id)), { id: kitchenId, label: "Kitchen", color: "#AAA398", kind: "kitchen" as const }];
    kitchens = lanes.filter((lane) => lane.kind === "kitchen");
  }
  const kitchen = kitchens[kitchens.length - 1];
  lanes = [
    ...lanes.filter((lane) => lane.id !== kitchen.id).map((lane) => (lane.kind === "kitchen" ? { ...lane, kind: "component" as const } : lane)),
    kitchen,
  ];
  if (lanes.length < 2) throw new Error("The Cook Along view needs a component lane and the kitchen lane");
  // Colors follow the timeline's own order, so a lane keeps its color if it moves.
  const colors = laneDisplayColors(lanes);

  // Shared cards span adjacent lanes: move component lanes so each shared
  // step's lanes sit side by side when some order allows it.
  const known = new Set(lanes.map((lane) => lane.id));
  const order = adjacentLaneOrder(
    lanes.slice(0, -1).map((lane) => lane.id),
    kitchen.id,
    [...laneOf.values()].map((ids) => ids.filter((id) => known.has(id))),
  );
  if (order) {
    const byLaneId = new Map(lanes.map((lane) => [lane.id, lane] as const));
    lanes = [...order.map((id) => byLaneId.get(id)).filter((lane) => lane !== undefined), kitchen];
  }
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index] as const));
  for (const [taskId, ids] of laneOf) {
    const ordered = [...ids].filter((id) => laneIndex.has(id)).sort((a, b) => (laneIndex.get(a) ?? 0) - (laneIndex.get(b) ?? 0));
    if (ordered.length === 0) throw new Error(`Task ${taskId} has no lane`);
    const first = laneIndex.get(ordered[0]) ?? 0;
    const last = laneIndex.get(ordered[ordered.length - 1]) ?? 0;
    // A shared step across lanes that are not side by side spans the lanes between.
    laneOf.set(taskId, lanes.slice(first, last + 1).map((lane) => lane.id));
  }

  // Resources: declared ones, plus any a task or hold names without declaring.
  const holdsByTask = new Map<string, string[]>();
  for (const hold of timeline.resourceHolds) {
    if (!byOpenId.has(hold.taskId)) continue;
    holdsByTask.set(hold.taskId, [...(holdsByTask.get(hold.taskId) ?? []), hold.resourceId]);
  }
  const resources = unique([
    ...timeline.resources.map((resource) => resource.id),
    ...openTasks.flatMap((task) => [...task.scheduling.resourceIds, ...(holdsByTask.get(task.id) ?? [])]),
  ]).map((id) => resourceIds.get(id));
  if (resources.length > 32) throw new Error("Too many resources for the Cook Along view");

  // Dependencies the open scheduler implies: cook after all prep, serve last.
  const dependents = new Map<string, string[]>();
  for (const task of openTasks) for (const dep of task.dependencies) dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
  const prepSinks = openTasks
    .filter((task) => task.phase === "prep" && !(dependents.get(task.id) ?? []).some((id) => byOpenId.get(id)?.phase === "prep"))
    .map((task) => task.id);
  const sinks = openTasks.filter((task) => task.id !== serve.id && !(dependents.get(task.id) ?? []).length).map((task) => task.id);
  const ovenOn = new Set(openTasks.filter((task) => task.equipmentEvent === "oven-on").map((task) => task.id));
  const horizon = Math.min(
    MAX_TIMELINE_SECONDS,
    minuteSeconds(openTasks.reduce((sum, task) => sum + taskTiming(task).minutes * 60 + task.scheduling.waits.reduce((a, b) => a + b, 0), 0)),
  );

  const tasks: CookingTaskDefinition[] = openTasks.map((task) => {
    const deps = unique(task.dependencies.filter((id) => byOpenId.has(id) && id !== task.id));
    const implied = task.id === serve.id ? sinks : task.phase === "cook" ? prepSinks : [];
    const allDeps = unique([...deps, ...implied.filter((id) => id !== task.id)]);
    const wait = minuteSeconds(task.scheduling.waits.reduce((a, b) => a + b, 0));
    const ovenDeps = wait > 0 ? deps.filter((id) => ovenOn.has(id)) : [];
    const waits = allDeps.map((id) => {
      const counts = deps.includes(id) && (ovenDeps.length === 0 || ovenDeps.includes(id));
      const minWaitSeconds = Math.min(MAX_TIMELINE_SECONDS, counts ? wait : 0);
      return { taskId: taskIds.get(id), minWaitSeconds, maxWaitSeconds: Math.max(minWaitSeconds, horizon) };
    });
    const { minutes, range } = taskTiming(task);
    const description = task.description.trim();
    const why = task.why?.trim() ?? "";
    const withWhy = why && description.length + 1 + why.length <= INSTRUCTION_MAX;
    const watch = cues(task);
    const points = watch && range ? [{ afterMinutes: range.min, label: clip(watch, INSTRUCTION_MAX) }] : undefined;
    const tip = clip(
      [task.tip?.trim() ?? "", withWhy ? "" : why, watch && !range ? `Watch for: ${watch}` : ""].filter(Boolean).map(sentence).join(" "),
      INSTRUCTION_MAX,
    );
    return {
      id: taskIds.get(task.id),
      phase: task.phase,
      label: clip(task.label.trim(), LABEL_MAX),
      description: clip(withWhy ? `${description} ${why}` : description, INSTRUCTION_MAX),
      ...(withWhy ? { instructionParts: [{ kind: "essential" as const, text: description }, { kind: "explanation" as const, text: ` ${why}` }] } : {}),
      completionCue: clip(task.completionCue.trim(), CUE_MAX),
      ...(cardTitle(task) ? { cardTitle: cardTitle(task) } : {}),
      minutes,
      ...(range ? { range } : {}),
      timingBasis: task.timingBasis,
      // Estimates are the cook's to change in Adjust Cooking Times; source timings stay fixed.
      ...(task.timingBasis === "estimate" ? { editableMinutes: true } : {}),
      attention: task.attention,
      timerEnabledByDefault: task.timerEnabledByDefault,
      laneIds: (laneOf.get(task.id) ?? []).map((id) => laneIds.get(id)),
      dependencies: allDeps.map((id) => taskIds.get(id)),
      sourceStepIds: unique(task.sourceStepIds.map((id) => stepIds.get(id))),
      ...(tip ? { tip } : {}),
      ...(points ? { checkpoints: points } : {}),
      ...(task.equipmentEvent ? { equipmentEvent: task.equipmentEvent } : {}),
      scheduling: {
        waits,
        resourceIds: unique([...task.scheduling.resourceIds, ...(holdsByTask.get(task.id) ?? [])].map((id) => resourceIds.get(id))),
        ingredientIds: unique(task.scheduling.ingredientIds.map((id) => ingredientIds.get(id))),
      },
    };
  });

  // The view checks that every listed source step and ingredient is used.
  let usedIngredients = unique(tasks.flatMap((task) => task.scheduling.ingredientIds));
  if (usedIngredients.length === 0) {
    const first = ingredientIds.get(recipe.ingredients[0]?.id ?? "ingredient");
    tasks[0].scheduling.ingredientIds = [first];
    usedIngredients = [first];
  }
  const phases = PHASE_ORDER.filter((phase) => tasks.some((task) => task.phase === phase))
    .map((phase) => ({ id: phase, label: PHASE_LABELS[phase] }));

  const timelineDefinition: CookingTimelineDefinition = {
    kind: "experimental-pilot",
    id: `open-${sha256Hex(artifact.id).slice(0, 24)}`,
    revision: `v1-${fingerprint.slice(0, 12)}`,
    sourceFingerprint: fingerprint,
    servings,
    effectiveIdentity,
    supportedSource: {
      kind: "generated-serving-profile",
      nativeServings: recipe.nativeServings ?? recipe.servings,
      servings,
      profileId: `kitchen-${artifact.equipmentProfile.burners}-burners${artifact.equipmentProfile.oven ? "-oven" : ""}`,
    },
    mode: "fresh",
    cookCount: 1,
    lanes: lanes.map((lane) => ({
      id: laneIds.get(lane.id),
      label: lane.label.trim() || (lane.kind === "kitchen" ? "Kitchen" : "Component"),
      color: colors.get(lane.id) ?? "#AAA398",
      kind: lane.kind,
    })),
    phases,
    tasks,
    resources: resources.map((id) => ({ id })),
    resourceHolds: [],
    sourceStepIds: unique(tasks.flatMap((task) => task.sourceStepIds)),
    ingredientIds: usedIngredients,
    serveTaskId: taskIds.get(serve.id),
  };

  const traces = rollUpTraces(recipe.ingredients);
  const pilotRecipe: CookingPilotRecipe = {
    id: `${artifact.id.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "recipe"}:${effectiveIdentity}`.slice(0, 300),
    effectiveIdentity,
    methodServings: servings,
    ...(recipe.methodLabel ? { methodLabel: recipe.methodLabel } : {}),
    ...(recipe.methodNotice ? { methodNotice: recipe.methodNotice } : {}),
    title: recipe.title,
    servings,
    sourceFingerprint: fingerprint,
    ingredients: recipe.ingredients.map((ingredient) => {
      const amount = formatQuantityWithUnit(ingredient.cookQuantity ?? ingredient.quantity, ingredient.unit);
      const buy = ingredient.buyQuantity ? `buy ${formatQuantityWithUnit(ingredient.buyQuantity, ingredient.unit)}` : "";
      const note = [ingredient.note?.trim() ?? "", buy].filter(Boolean).join(" · ");
      return { name: ingredient.name, quantity: amount, unit: "", note: note || null };
    }),
    equipment: recipe.equipment,
    steps: recipe.steps.map((step) => ({ kind: step.kind, text: step.text })),
    allergens: recipe.allergens,
    allergenTraces: traces,
  };

  return { recipe: pilotRecipe, timelineDefinition: cookingTimelineDefinitionSchema.parse(timelineDefinition) as CookingTimelineDefinition };
}

/**
 * The Cook Along view's props for an artifact, or null when it cannot show
 * one (adaptation or scheduling fails): the caller then shows the open
 * sections instead.
 */
export function cookingPilotInput(artifact: CookAlongArtifact): CookingPilotInput | null {
  try {
    const input = adaptArtifactForCookingPilot(artifact);
    const plan = buildCookingPlan(structuredClone(input.timelineDefinition));
    return { ...input, serveMinute: plan.serveMinute };
  } catch {
    return null;
  }
}
