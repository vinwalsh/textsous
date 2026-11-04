import type { ZodIssue } from "zod";
import { CanonicalRecipeSchema, EU14_ALLERGENS, type CanonicalRecipe } from "../schema/canonical";
import { TimelineDefinitionSchema, type TimelineDefinition } from "../schema/timeline";
import { skillsError, type SkillsError, type SkillsWarning } from "./errors";

/** Render a zod path like ["tasks", 3, "minutes"] as "tasks[3].minutes". */
export function formatPath(parts: Array<string | number>): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${part}` : part;
  }
  return out;
}

function recipePath(parts: Array<string | number>): string {
  const [head, ...rest] = parts;
  if (head === "source") return formatPath(parts);
  if (head === "nativeServings") return "recipe.servings";
  return formatPath(["recipe", ...(head === undefined ? [] : [head]), ...rest]);
}

function timelinePath(parts: Array<string | number>): string {
  // Scheduling fields are flat on the lenient task: tasks[i].ingredientIds.
  if (parts[0] === "tasks" && parts[2] === "scheduling" && typeof parts[3] === "string") {
    return formatPath(["timeline", ...parts.slice(0, 2), ...parts.slice(3)]);
  }
  return formatPath(["timeline", ...parts]);
}

/** Turn a zod issue into one actionable sentence. */
export function issueMessage(issue: ZodIssue, path: string): string {
  const field = path || "the body";
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") return `Add ${field}: it is required (${issue.expected}).`;
      return `Set ${field} to a ${issue.expected}; it is a ${issue.received}.`;
    case "invalid_enum_value":
      if (/allergen/i.test(path)) {
        return `Use an EU-14 slug at ${field}: one of ${EU14_ALLERGENS.join(", ")}. "${String(issue.received)}" is not one.`;
      }
      return `Set ${field} to one of ${issue.options.map((o) => `"${String(o)}"`).join(", ")}; "${String(issue.received)}" is not allowed.`;
    case "too_small":
      if (issue.type === "string") return `Fill in ${field}: it must not be empty.`;
      if (issue.type === "array") return `Give ${field} at least ${String(issue.minimum)} item(s).`;
      return `Raise ${field} to at least ${String(issue.minimum)}.`;
    case "too_big":
      if (issue.type === "number" && /minutes|range/.test(path)) {
        return `Lower ${field} to at most ${String(issue.maximum)}; split a longer task into several tasks.`;
      }
      return `Lower ${field} to at most ${String(issue.maximum)}.`;
    case "unrecognized_keys":
      return `Remove ${issue.keys.join(", ")} from ${field}.`;
    default:
      return `Fix ${field}: ${issue.message}.`;
  }
}

function zodErrors(
  issues: ZodIssue[],
  toPath: (parts: Array<string | number>) => string,
): SkillsError[] {
  return issues.map((issue) => {
    const path = toPath(issue.path);
    return skillsError(path, "invalid_value", issueMessage(issue, path));
  });
}

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HAS_NUMBER = /\d|°|½|¼|¾|⅓|⅔|⅛/;

const PREP_NOTE = /\b(dic|chop|minc|grat|slic|peel|julienn|shred|crush|zest|trim|halv|quarter|cub|mash|rins|drain|soak|thaw|toast|melt|sift|beat|whisk|separat|pit|seed|core|cut|tear|torn|smash|juic|squeez)/i;

export interface ValidationContext {
  /** Source text for quote and fidelity checks; null skips those checks. */
  sourceText: string | null;
}

/**
 * Strict validation of a normalized cook along. Returns path-specific errors
 * (blocking) and warnings (advice). Runs the real zod schemas plus the rule
 * checks whose failure would otherwise surface only as an aggregate
 * procedure or review detail, so each problem points at the field to fix.
 */
export function validateCookAlong(
  recipe: CanonicalRecipe,
  timeline: TimelineDefinition,
  ctx: ValidationContext,
): { errors: SkillsError[]; warnings: SkillsWarning[] } {
  const errors: SkillsError[] = [];
  const warnings: SkillsWarning[] = [];

  const canonical = CanonicalRecipeSchema.safeParse(recipe);
  if (!canonical.success) errors.push(...zodErrors(canonical.error.issues, recipePath));
  const strictTimeline = TimelineDefinitionSchema.safeParse(timeline);
  if (!strictTimeline.success) errors.push(...zodErrors(strictTimeline.error.issues, timelinePath));

  const duplicates = (ids: string[], at: (i: number) => string, what: string): void => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (!id) return;
      if (seen.has(id)) {
        errors.push(skillsError(at(i), "duplicate_id", `Rename ${what} "${id}" at ${at(i)}: another ${what} already uses it.`));
      }
      seen.add(id);
    });
  };
  duplicates(recipe.ingredients.map((x) => x.id), (i) => `recipe.ingredients[${i}].id`, "ingredient id");
  duplicates(recipe.steps.map((x) => x.id), (i) => `recipe.steps[${i}].id`, "step id");
  duplicates(timeline.lanes.map((x) => x.id), (i) => `timeline.lanes[${i}].id`, "lane id");
  duplicates(timeline.tasks.map((x) => x.id), (i) => `timeline.tasks[${i}].id`, "task id");
  duplicates(timeline.resources.map((x) => x.id), (i) => `timeline.resources[${i}].id`, "resource id");

  const kitchen = timeline.lanes.filter((l) => l.kind === "kitchen");
  const components = timeline.lanes.filter((l) => l.kind === "component");
  if (timeline.lanes.length > 0 && (kitchen.length !== 1 || components.length === 0 || timeline.lanes[timeline.lanes.length - 1].kind !== "kitchen")) {
    errors.push(
      skillsError(
        "timeline.lanes",
        "lanes",
        `Use one lane per component (kind "component") and exactly one kitchen lane (kind "kitchen") as the last lane; you sent ${components.length} component and ${kitchen.length} kitchen lane(s)${kitchen.length === 1 ? " with the kitchen lane not last" : ""}.`,
      ),
    );
  }

  const stepIds = new Set(recipe.steps.map((s) => s.id));
  const laneIds = new Set(timeline.lanes.map((l) => l.id));
  const resourceIds = new Set(timeline.resources.map((r) => r.id));
  const ingredientIds = new Set(recipe.ingredients.map((i) => i.id));
  const taskById = new Map(timeline.tasks.map((t) => [t.id, t] as const));
  const list = (ids: Set<string>) => [...ids].join(", ") || "(none)";
  const stepPool = recipe.steps.map((s) => s.text);
  const normalizedSource = ctx.sourceText ? normalizeText(ctx.sourceText) : null;

  timeline.tasks.forEach((task, i) => {
    const at = `timeline.tasks[${i}]`;
    task.sourceStepIds.forEach((id, j) => {
      if (!stepIds.has(id)) {
        errors.push(skillsError(`${at}.sourceStepIds[${j}]`, "unknown_reference", `Cite a step id from recipe.steps (${list(stepIds)}); "${id}" does not exist.`));
      }
    });
    task.laneIds.forEach((id, j) => {
      if (!laneIds.has(id)) {
        errors.push(skillsError(`${at}.laneIds[${j}]`, "unknown_reference", `Use a lane id from timeline.lanes (${list(laneIds)}); "${id}" does not exist.`));
      }
    });
    task.dependencies.forEach((id, j) => {
      const dep = taskById.get(id);
      if (id === task.id) {
        errors.push(skillsError(`${at}.dependencies[${j}]`, "self_dependency", `Remove "${id}" from its own dependencies.`));
      } else if (!dep) {
        errors.push(skillsError(`${at}.dependencies[${j}]`, "unknown_reference", `Depend only on task ids in timeline.tasks; "${id}" does not exist.`));
      } else if (task.phase === "prep" && dep.phase !== "prep") {
        errors.push(skillsError(`${at}.dependencies[${j}]`, "prep_depends_on_cook", `Prep task "${task.id}" cannot wait for ${dep.phase} task "${id}": mise en place comes first. Make "${task.id}" a cook task or drop the dependency.`));
      }
    });
    task.scheduling.ingredientIds.forEach((id, j) => {
      if (!ingredientIds.has(id)) {
        errors.push(skillsError(`${at}.ingredientIds[${j}]`, "unknown_reference", `Use an ingredient id from recipe.ingredients (${list(ingredientIds)}); "${id}" does not exist.`));
      }
    });
    task.scheduling.resourceIds.forEach((id, j) => {
      if (!resourceIds.has(id)) {
        errors.push(skillsError(`${at}.resourceIds[${j}]`, "unknown_reference", `Declare "${id}" in timeline.resources or remove it; known resources: ${list(resourceIds)}.`));
      }
    });

    if (task.timingBasis === "source") {
      const quote = task.sourceQuote ?? "";
      if (!quote) {
        errors.push(skillsError(`${at}.sourceQuote`, "quote_missing", `Add sourceQuote with the exact words that state ${task.minutes} minutes, or set timingBasis to "estimate".`));
      } else if (!stepPool.some((text) => text.includes(quote))) {
        errors.push(skillsError(`${at}.sourceQuote`, "quote_not_in_steps", `"${quote}" is not in any step text. Copy the quote character for character from the step that states the time, or set timingBasis to "estimate".`));
      } else if (normalizedSource !== null && !normalizedSource.includes(normalizeText(quote))) {
        errors.push(skillsError(`${at}.sourceQuote`, "quote_not_in_source", `"${quote}" is not in the original recipe text. Keep step text verbatim from the source, or set timingBasis to "estimate".`));
      }
    }

    const title = [task.cardTitle.action, task.cardTitle.subject, task.cardTitle.context].join(" ");
    if (HAS_NUMBER.test(title)) {
      errors.push(skillsError(`${at}.cardTitle`, "numbers_in_card_title", `Remove amounts, times and temperatures from the card title "${title.trim()}" and keep them in the description. If you left cardTitle out, it was derived from the label: send a cardTitle without numbers.`));
    }
    if (HAS_NUMBER.test(task.label)) {
      warnings.push({ code: "numbers_in_label", path: `${at}.label`, message: "Keep amounts, times and temperatures out of labels; put them in the description." });
    }
    if (task.range && task.range.low > task.range.high) {
      errors.push(skillsError(`${at}.range`, "range_order", `Swap the range: low (${task.range.low}) is above high (${task.range.high}).`));
    } else if (task.range && (task.minutes < task.range.low || task.minutes > task.range.high)) {
      warnings.push({ code: "minutes_outside_range", path: `${at}.minutes`, message: `minutes (${task.minutes}) is outside range ${task.range.low}-${task.range.high}; use a value inside the range.` });
    }
    if (task.attention === "hands-on" && task.minutes > 15 && task.checkpoints.length === 0) {
      errors.push(skillsError(`${at}.checkpoints`, "needs_checkpoints", `Hands-on task "${task.id}" runs ${task.minutes} minutes: add observable checkpoints, split it, or mark the waiting part as a separate unattended task.`));
    }
  });

  timeline.resourceHolds.forEach((hold, i) => {
    if (!taskById.has(hold.taskId)) {
      errors.push(skillsError(`timeline.resourceHolds[${i}].taskId`, "unknown_reference", `Use a task id from timeline.tasks; "${hold.taskId}" does not exist.`));
    }
    if (!resourceIds.has(hold.resourceId)) {
      errors.push(skillsError(`timeline.resourceHolds[${i}].resourceId`, "unknown_reference", `Declare "${hold.resourceId}" in timeline.resources or remove this hold.`));
    }
  });

  if (timeline.serveTaskId && !taskById.has(timeline.serveTaskId)) {
    errors.push(skillsError("timeline.serveTaskId", "unknown_reference", `Set serveTaskId to the id of the final serving task; "${timeline.serveTaskId}" is not a task.`));
  }

  const cycle = findCycle(timeline);
  if (cycle) {
    const index = timeline.tasks.findIndex((t) => t.id === cycle[0]);
    errors.push(skillsError(`timeline.tasks[${index}].dependencies`, "dependency_cycle", `Break the dependency loop ${cycle.join(" -> ")}: a task cannot wait for itself.`));
  }

  const cited = new Set(timeline.tasks.flatMap((t) => t.scheduling.ingredientIds));
  recipe.ingredients.forEach((ing, i) => {
    if (!cited.has(ing.id)) {
      errors.push(skillsError(`recipe.ingredients[${i}]`, "unused_ingredient", `No task uses "${ing.name}" (${ing.id}): add "${ing.id}" to ingredientIds of the task that uses it.`));
    }
  });

  // Advice only: these rules need judgment, so they never block a save.
  recipe.ingredients.forEach((ing, i) => {
    const users = timeline.tasks.filter((t) => t.scheduling.ingredientIds.includes(ing.id));
    if (ing.note && PREP_NOTE.test(ing.note) && !users.some((t) => t.phase === "prep")) {
      warnings.push({ code: "prep_task_missing", path: `recipe.ingredients[${i}].note`, message: `"${ing.name}" is noted "${ing.note}": add a prep task for that action and cite ${ing.id} in it.` });
    }
    if (ing.quantity && users.length > 0 && !users.some((t) => t.description.includes(ing.quantity))) {
      warnings.push({ code: "amount_missing", path: `recipe.ingredients[${i}]`, message: `No task description states "${[ing.quantity, ing.unit, ing.name].filter(Boolean).join(" ")}": put the exact amount, unit and name in the description of the task that measures or adds it.` });
    }
    if (normalizedSource !== null) {
      const words = normalizeText(ing.name).split(/[^a-z]+/).filter((w) => w.length >= 3);
      if (words.length > 0 && !words.some((w) => normalizedSource.includes(w.replace(/(es|s)$/, "")))) {
        warnings.push({ code: "ingredient_not_in_source", path: `recipe.ingredients[${i}].name`, message: `"${ing.name}" does not appear in the source text. Check that it is in the recipe; never add ingredients.` });
      }
    }
  });

  return { errors, warnings };
}

/** First dependency cycle as a list of task ids (closing id repeated), or null. */
export function findCycle(timeline: TimelineDefinition): string[] | null {
  const deps = new Map(timeline.tasks.map((t) => [t.id, t.dependencies] as const));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep) || dep === id) continue;
      if (state.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!state.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const task of timeline.tasks) {
    if (!state.has(task.id)) {
      const found = visit(task.id);
      if (found) return found;
    }
  }
  return null;
}
