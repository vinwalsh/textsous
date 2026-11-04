import type { CanonicalRecipe } from "../schema/canonical";
import type { TimelineDefinition, TimelineTask } from "../schema/timeline";

/** Edit distance between two short ids (Levenshtein). Pure. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * The known id an unknown one most likely meant: the single closest id at
 * edit distance 1-2 ("t-sofen" -> "t-soften"). Null when none is that close
 * or two are equally close. Pure.
 */
export function closestId(id: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  let tie = false;
  for (const candidate of known) {
    const distance = editDistance(id, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tie = false;
    } else if (distance === bestDistance) {
      tie = true;
    }
  }
  return best !== null && !tie ? best : null;
}

/** Map ids to known ones: exact, else closest, else dropped. Order kept, no duplicates. */
function remap(ids: readonly string[], known: readonly string[], fixes: string[], where: string): string[] {
  const knownSet = new Set(known);
  const out: string[] = [];
  for (const id of ids) {
    const mapped = knownSet.has(id) ? id : closestId(id, known);
    if (mapped === null) {
      fixes.push(`${where}: dropped unknown "${id}"`);
      continue;
    }
    if (mapped !== id) fixes.push(`${where}: "${id}" -> "${mapped}"`);
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export interface ReferenceRepair {
  timeline: TimelineDefinition;
  /** What was changed, for logs; never shown to readers. */
  fixes: string[];
}

/**
 * Make every id the model wrote point at something that exists, so the
 * scheduler never fails on a typo: task dependencies, resource holds, lanes,
 * scheduling resources, cited steps and the serve task. A near miss maps to
 * the closest id; anything else is dropped (a task keeps at least one lane
 * and one cited step). A self-dependency and a prep task waiting on a
 * non-prep task are dropped too. Content is never changed: the review still
 * judges the timeline. Pure.
 */
export function repairTimelineReferences(recipe: CanonicalRecipe, timeline: TimelineDefinition): ReferenceRepair {
  const fixes: string[] = [];
  const taskIds = timeline.tasks.map((task) => task.id);
  const laneIds = timeline.lanes.map((lane) => lane.id);
  const resourceIds = timeline.resources.map((resource) => resource.id);
  const stepIds = recipe.steps.map((step) => step.id);
  const phaseOf = new Map(timeline.tasks.map((task) => [task.id, task.phase] as const));

  const tasks = timeline.tasks.map((task): TimelineTask => {
    let dependencies = remap(task.dependencies, taskIds, fixes, `${task.id} dependency`).filter((id) => {
      if (id === task.id) {
        fixes.push(`${task.id}: dropped a dependency on itself`);
        return false;
      }
      if (task.phase === "prep" && phaseOf.get(id) !== "prep") {
        fixes.push(`${task.id}: prep task no longer waits on non-prep "${id}"`);
        return false;
      }
      return true;
    });
    let lanes = remap(task.laneIds, laneIds, fixes, `${task.id} lane`);
    if (lanes.length === 0 && laneIds.length > 0) lanes = [laneIds[0]];
    let steps = remap(task.sourceStepIds, stepIds, fixes, `${task.id} step`);
    if (steps.length === 0 && stepIds.length > 0) steps = [stepIds[0]];
    const resources = remap(task.scheduling.resourceIds, resourceIds, fixes, `${task.id} resource`);
    dependencies = dependencies.length === task.dependencies.length && dependencies.every((d, i) => d === task.dependencies[i])
      ? task.dependencies
      : dependencies;
    return {
      ...task,
      dependencies,
      laneIds: lanes,
      sourceStepIds: steps,
      scheduling: { ...task.scheduling, resourceIds: resources },
    };
  });

  const resourceHolds = timeline.resourceHolds.flatMap((hold) => {
    const [taskId] = remap([hold.taskId], taskIds, fixes, "hold task");
    const [resourceId] = remap([hold.resourceId], resourceIds, fixes, "hold resource");
    return taskId && resourceId ? [{ ...hold, taskId, resourceId }] : [];
  });

  let serveTaskId = timeline.serveTaskId;
  if (!taskIds.includes(serveTaskId)) {
    const finish = timeline.tasks.filter((task) => task.phase === "finish");
    const fallback = closestId(serveTaskId, taskIds) ?? (finish.at(-1) ?? timeline.tasks.at(-1))?.id ?? serveTaskId;
    fixes.push(`serveTaskId "${serveTaskId}" -> "${fallback}"`);
    serveTaskId = fallback;
  }

  return { timeline: { ...timeline, tasks, resourceHolds, serveTaskId }, fixes };
}
