import {
  cookingProcedureSchema,
  experimentalCookingProcedureSchema,
  validationContextSchema,
  type ExperimentalCookingProcedure,
  type SchedulingProcedure,
  type ValidationContext,
  type ProcedureValidationResult,
  type ValidationIssue,
  type ValidationIssueCode,
} from "./types";

/**
 * Structural readiness for the bounded static scheduler. The caller supplies
 * an independently trusted effective-recipe fingerprint and source inventory.
 * A submitted reviewer name/evidence is an attestation, never authorization or
 * proof that the culinary review actually happened. No source is inferred here.
 */
export function validateProcedure(
  input: unknown,
  context: unknown,
): ProcedureValidationResult {
  const parsed = cookingProcedureSchema.safeParse(input);
  const parsedContext = validationContextSchema.safeParse(context);
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add("schema", issue.path.join("."), issue.message);
  }
  if (!parsedContext.success) {
    for (const issue of parsedContext.error.issues) add("context", ["context", ...issue.path].join("."), issue.message);
  }
  if (!parsed.success || !parsedContext.success) return { ok: false, issues };

  return validateGraph(parsed.data, parsedContext.data);
}

/** Curated experimental pilot only. This does not produce a reviewed procedure
 * and is deliberately not accepted by previewCookingTimeline. */
export function validateExperimentalProcedure(input: unknown, context: unknown):
  | { ok: true; procedure: ExperimentalCookingProcedure }
  | { ok: false; issues: ValidationIssue[] } {
  const parsed = experimentalCookingProcedureSchema.safeParse(input);
  const trusted = validationContextSchema.safeParse(context);
  if (!parsed.success || !trusted.success) return { ok: false, issues: [
    ...(!parsed.success ? parsed.error.issues.map(issue => ({ code: "schema" as const, path: issue.path.join("."), message: issue.message })) : []),
    ...(!trusted.success ? trusted.error.issues.map(issue => ({ code: "context" as const, path: `context.${issue.path.join(".")}`, message: issue.message })) : []),
  ] };
  return validateGraph(parsed.data, trusted.data);
}

function validateGraph<T extends SchedulingProcedure>(procedure: T, trusted: ValidationContext):
  | { ok: true; procedure: T }
  | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const unique = (values: string[], path: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) add("duplicate_id", `${path}.${index}`, `Duplicate ID: ${value}`);
      seen.add(value);
    });
  };
  for (const field of ["components", "lanes", "resources", "tasks", "resourceHolds"] as const) {
    unique(procedure[field].map(item => item.id), field);
  }
  for (const field of ["availableResourceIds", "sourceStepIds", "ingredientIds"] as const) {
    unique(trusted[field], `context.${field}`);
  }
  if (procedure.sourceFingerprint !== trusted.sourceFingerprint) {
    add("stale_source", "sourceFingerprint", "Procedure does not match the current effective recipe");
  }
  if (procedure.servings !== trusted.servings) {
    add("servings_mismatch", "servings", "Procedure was reviewed for different servings");
  }

  const components = new Set(procedure.components.map(item => item.id));
  const lanes = new Map(procedure.lanes.map(item => [item.id, item]));
  const resources = new Set(procedure.resources.map(item => item.id));
  const available = new Set(trusted.availableResourceIds);
  const tasks = new Map(procedure.tasks.map(item => [item.id, item]));
  const expectedSteps = new Set(trusted.sourceStepIds);
  const expectedIngredients = new Set(trusted.ingredientIds);
  const coveredSteps = new Set<string>();
  const coveredIngredients = new Set<string>();
  const componentLanes = new Set<string>();
  let kitchenLanes = 0;

  procedure.lanes.forEach((lane, index) => {
    if (lane.kind === "kitchen") {
      kitchenLanes++;
    } else {
      if (!components.has(lane.componentId)) add("missing_reference", `lanes.${index}.componentId`, "Unknown component");
      if (componentLanes.has(lane.componentId)) add("duplicate_id", `lanes.${index}.componentId`, "Component has more than one lane");
      componentLanes.add(lane.componentId);
    }
    if (!procedure.tasks.some(task => (task.participatingLaneIds ?? [task.laneId]).includes(lane.id))) add("coverage", `lanes.${index}`, "Lane has no task");
  });
  if (kitchenLanes !== 1) add("unsupported", "lanes", "Exactly one kitchen lane is required");
  for (const componentId of components) {
    if (!componentLanes.has(componentId)) add("coverage", "lanes", `Component has no lane: ${componentId}`);
  }
  procedure.resources.forEach((resource, index) => {
    if (!available.has(resource.id)) add("unavailable_resource", `resources.${index}.id`, `Resource is not available: ${resource.id}`);
  });

  procedure.tasks.forEach((task, index) => {
    const path = `tasks.${index}`;
    if (!lanes.has(task.laneId)) add("missing_reference", `${path}.laneId`, "Unknown lane");
    const participating = task.participatingLaneIds ?? [task.laneId];
    unique(participating, `${path}.participatingLaneIds`);
    if (!participating.includes(task.laneId)) add("coverage", `${path}.participatingLaneIds`, "Shared participation must include the primary lane");
    for (const laneId of participating) if (!lanes.has(laneId)) add("missing_reference", `${path}.participatingLaneIds`, "Unknown participating lane");
    unique(task.dependencies.map(dependency => dependency.taskId), `${path}.dependencies`);
    unique(task.resourceIds, `${path}.resourceIds`);
    unique(task.sourceStepIds, `${path}.sourceStepIds`);
    unique(task.ingredientIds, `${path}.ingredientIds`);
    for (const dependency of task.dependencies) {
      if (!tasks.has(dependency.taskId)) add("missing_reference", `${path}.dependencies`, `Unknown predecessor: ${dependency.taskId}`);
    }
    for (const resourceId of task.resourceIds) {
      if (!resources.has(resourceId)) add("missing_reference", `${path}.resourceIds`, `Undeclared resource: ${resourceId}`);
    }
    for (const sourceId of task.sourceStepIds) {
      if (!expectedSteps.has(sourceId)) add("coverage", `${path}.sourceStepIds`, `Unknown source step: ${sourceId}`);
      coveredSteps.add(sourceId);
    }
    for (const ingredientId of task.ingredientIds) {
      if (!expectedIngredients.has(ingredientId)) add("coverage", `${path}.ingredientIds`, `Unknown source ingredient: ${ingredientId}`);
      coveredIngredients.add(ingredientId);
    }
    if (participating.some(laneId => lanes.get(laneId)?.kind === "component") && !task.sourceStepIds.length) {
      add("coverage", `${path}.sourceStepIds`, "Component tasks must reference their reviewed source steps");
    }
  });
  for (const sourceId of expectedSteps) {
    if (!coveredSteps.has(sourceId)) add("coverage", "tasks", `Source step is uncovered: ${sourceId}`);
  }
  for (const ingredientId of expectedIngredients) {
    if (!coveredIngredients.has(ingredientId)) add("coverage", "tasks", `Source ingredient is uncovered: ${ingredientId}`);
  }

  // Bounded iterative reachability also terminates on malformed cyclic graphs.
  const ancestors = new Map<string, Set<string>>();
  for (const task of procedure.tasks) {
    const found = new Set<string>();
    const pending = task.dependencies.map(dependency => dependency.taskId);
    for (let index = 0; index < pending.length; index++) {
      const predecessor = pending[index];
      if (found.has(predecessor) || !tasks.has(predecessor)) continue;
      found.add(predecessor);
      pending.push(...tasks.get(predecessor)!.dependencies.map(dependency => dependency.taskId));
    }
    ancestors.set(task.id, found);
    if (found.has(task.id)) add("cycle", "tasks", `Dependency cycle includes: ${task.id}`);
  }
  const precedes = (first: string, last: string): boolean => ancestors.get(last)?.has(first) ?? false;
  const containmentPairs = new Set<string>();
  for (const [index, containment] of (procedure.containments ?? []).entries()) {
    const path = `containments.${index}`, process = tasks.get(containment.processTaskId), activity = tasks.get(containment.activityTaskId);
    const key = JSON.stringify([containment.processTaskId, containment.activityTaskId]);
    if (containmentPairs.has(key)) add("duplicate_id", path, "Duplicate task containment");
    containmentPairs.add(key);
    if (!process || !activity) { add("missing_reference", path, "Containment endpoints must name existing tasks"); continue; }
    if (process.id === activity.id) add("containment", path, "A task cannot contain itself");
    if (activity.duration.maxSeconds > process.duration.maxSeconds) add("containment", path, "Activity exceeds the complete process interval");
    if (precedes(process.id, activity.id) || precedes(activity.id, process.id)) add("containment", path, "End-to-start prerequisites cannot order tasks that must overlap completely");
    if (process.attention === "hands-on" && activity.attention === "hands-on") add("containment", path, "One cook cannot perform two hands-on tasks during the same interval");
    if (process.resourceIds.some(resourceId => activity.resourceIds.includes(resourceId))) add("containment", path, "Contained tasks cannot occupy the same exclusive resource");
  }
  const serve = tasks.get(procedure.serveTaskId);
  if (!serve) add("missing_reference", "serveTaskId", "Serving task is missing");
  if (serve?.kind !== "serve" || procedure.tasks.filter(task => task.kind === "serve").length !== 1) {
    add("unsupported", "serveTaskId", "Exactly one serving task must match serveTaskId");
  }
  if (serve) {
    for (const task of procedure.tasks) {
      if (task.id !== serve.id && !precedes(task.id, serve.id)) {
        add("orphan", "tasks", `Task does not lead to serving: ${task.id}`);
      }
    }
  }

  const resourceOwners = new Set<string>();
  procedure.resourceHolds.forEach((hold, index) => {
    const path = `resourceHolds.${index}`;
    unique(hold.taskIds, `${path}.taskIds`);
    if (!resources.has(hold.resourceId)) add("missing_reference", `${path}.resourceId`, "Hold references an undeclared resource");
    for (const endpoint of ["startTaskId", "endTaskId"] as const) {
      if (!tasks.has(hold[endpoint])) add("missing_reference", `${path}.${endpoint}`, "Hold endpoint is missing");
      if (!hold.taskIds.includes(hold[endpoint])) add("resource_hold", `${path}.taskIds`, "Hold must include both endpoints as participants");
    }
    if (hold.startTaskId !== hold.endTaskId && !precedes(hold.startTaskId, hold.endTaskId)) {
      add("resource_hold", path, "Hold endpoints must follow the dependency order");
    }
    for (const taskId of hold.taskIds) {
      const task = tasks.get(taskId);
      if (!task) {
        add("missing_reference", `${path}.taskIds`, `Unknown hold participant: ${taskId}`);
        continue;
      }
      if (!task.resourceIds.includes(hold.resourceId)) add("resource_hold", `${path}.taskIds`, `Participant does not use the held resource: ${taskId}`);
      const afterStart = taskId === hold.startTaskId || precedes(hold.startTaskId, taskId);
      const beforeEnd = taskId === hold.endTaskId || precedes(taskId, hold.endTaskId);
      if (!afterStart || !beforeEnd) add("resource_hold", `${path}.taskIds`, `Participant is outside the hold's dependency path: ${taskId}`);
      const key = JSON.stringify([taskId, hold.resourceId]);
      if (resourceOwners.has(key)) add("resource_hold", `${path}.taskIds`, "Task/resource pair belongs to multiple holds");
      resourceOwners.add(key);
    }
  });
  for (let left = 0; left < procedure.resourceHolds.length; left++) {
    const a = procedure.resourceHolds[left];
    for (let right = left + 1; right < procedure.resourceHolds.length; right++) {
      const b = procedure.resourceHolds[right];
      if (a.resourceId !== b.resourceId) continue;
      // Positive task durations make shared/nested endpoints overlap too.
      const aBeginsBeforeBEnds = a.startTaskId === b.endTaskId || precedes(a.startTaskId, b.endTaskId);
      const bBeginsBeforeAEnds = b.startTaskId === a.endTaskId || precedes(b.startTaskId, a.endTaskId);
      if (aBeginsBeforeBEnds && bBeginsBeforeAEnds) {
        add("resource_hold", `resourceHolds.${right}`, "Dependency order forces overlapping holds on an exclusive resource");
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, procedure };
}
