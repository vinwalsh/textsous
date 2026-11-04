import { DEFAULT_EQUIPMENT_PROFILE } from "../pipeline";
import type { CookAlongArtifact, EquipmentProfile } from "../schema/artifact";
import { schedule, type ScheduleResult } from "../scheduler/schedule";
import { runFormatWarnings } from "../format";
import type { TimelineDefinition } from "../schema/timeline";
import { compile } from "../stages/compile";
import { runProcedureChecks } from "../stages/procedure";
import {
  MODEL_JUDGMENT_NAMES,
  REVIEW_CHECK_ORDER,
  runCodedReviewChecks,
  type ReviewCheck,
  type ReviewInput,
  type ReviewResult,
} from "../stages/review";
import { skillsError, type SkillsError, type SkillsWarning } from "./errors";
import { CookAlongRequestSchema, unknownKeyPaths, type CookAlongRequest } from "./input";
import { normalize, type ResolvedSource } from "./normalize";
import { getRecipeSource, type SourceResult } from "./source";
import { formatPath, issueMessage, validateCookAlong } from "./validate";

export interface CookAlongSummary {
  title: string;
  servings: number;
  totalMinutes: number;
  handsOnMinutes: number;
  taskCount: number;
  allergens: string[];
}

export type PrepareResult =
  | {
      ok: true;
      artifact: CookAlongArtifact;
      schedule: ScheduleResult;
      review: ReviewResult;
      summary: CookAlongSummary;
      warnings: SkillsWarning[];
    }
  | { ok: false; errors: SkillsError[]; warnings: SkillsWarning[] };

export interface PrepareOptions {
  /** Source fetcher for kind "url" (tests inject a fake). */
  fetchSource?: (url: string) => Promise<SourceResult>;
  equipmentProfile?: EquipmentProfile;
}

const NOT_RUN_DETAIL =
  "not run: the recipe and timeline were written by the person's own AI assistant through the TextSous skills API";

/**
 * Review result for an assistant-authored cook along: the 5 coded checks run
 * for real; the 7 model judgments are recorded as not run (no model calls on
 * this path). Only coded failures block compile.
 */
export function assistantAuthoredReview(input: ReviewInput): ReviewResult {
  const coded = runCodedReviewChecks(input);
  const notRun: ReviewCheck[] = MODEL_JUDGMENT_NAMES.map((name) => ({
    name,
    passed: false,
    detail: NOT_RUN_DETAIL,
    source: "model" as const,
    notRun: true,
  }));
  const order = new Map(REVIEW_CHECK_ORDER.map((name, i) => [name, i] as const));
  const checks = [...coded, ...notRun].sort(
    (a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99),
  );
  const blockers = checks.filter((c) => !c.passed && !c.notRun).map((c) => `${c.name}: ${c.detail}`);
  return {
    checks,
    passed: blockers.length === 0,
    blockers,
    warnings: runFormatWarnings(input.recipe, input.timeline, input.schedule),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    fallbackUsed: false,
    attempts: 0,
    rawResponse: "",
  };
}

/** The converter's non-blocking format warnings, pointed at the task to improve. */
function formatAdvice(review: ReviewResult, timeline: TimelineDefinition): SkillsWarning[] {
  const index = new Map(timeline.tasks.map((task, i) => [task.id, i] as const));
  return (review.warnings ?? []).map((w) => {
    const i = w.taskId === undefined ? undefined : index.get(w.taskId);
    return { code: w.code, message: w.message, ...(i === undefined ? {} : { path: `timeline.tasks[${i}]` }) };
  });
}

/** Summary minutes come from the code schedule, never from the assistant. */
export function summarize(artifact: CookAlongArtifact, sched: ScheduleResult): CookAlongSummary {
  const byId = new Map(sched.tasks.map((t) => [t.id, t] as const));
  const handsOn = artifact.timelineDefinition.tasks
    .filter((t) => t.attention === "hands-on")
    .reduce((sum, t) => {
      const placed = byId.get(t.id);
      return sum + (placed ? placed.endMinutes - placed.startMinutes : t.minutes);
    }, 0);
  return {
    title: artifact.recipe.title,
    servings: artifact.recipe.servings,
    totalMinutes: sched.totalMinutes,
    handsOnMinutes: handsOn,
    taskCount: artifact.timelineDefinition.tasks.length,
    allergens: artifact.recipe.allergens,
  };
}

async function resolveSource(
  body: CookAlongRequest,
  fetchSource: (url: string) => Promise<SourceResult>,
  warnings: SkillsWarning[],
): Promise<{ source: ResolvedSource } | { error: SkillsError }> {
  const s = body.source;
  const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
  const bodyText = clean(s.text);
  const base: ResolvedSource = {
    kind: s.kind,
    url: null,
    site: clean(s.site),
    author: clean(s.author),
    book: clean(s.book),
    page: s.page ?? null,
    license: clean(s.license),
    text: bodyText,
  };
  if (s.kind !== "url") {
    if (!bodyText) {
      return {
        error: skillsError(
          "source.text",
          "missing_source_text",
          s.kind === "photo"
            ? "Add source.text: the transcription of the photo, word for word, as the person confirmed it."
            : "Add source.text: the recipe text exactly as the person pasted it.",
        ),
      };
    }
    // Only a re-fetched page earns a "View original" link.
    return { source: base };
  }
  const url = clean(s.url);
  if (!url) {
    return { error: skillsError("source.url", "invalid_value", 'Add source.url: the https link of the recipe page (kind "url").') };
  }
  const fetched = await fetchSource(url);
  if (fetched.ok) {
    return {
      source: {
        ...base,
        url: fetched.source.url,
        site: fetched.source.site ?? base.site,
        author: fetched.source.author ?? base.author,
        text: fetched.source.text,
      },
    };
  }
  if (fetched.error.code === "refused_url") {
    return { error: skillsError("source.url", "refused_url", fetched.error.message) };
  }
  warnings.push({
    code: "source_fetch_failed",
    path: "source.url",
    message: bodyText
      ? "The recipe page could not be fetched again, so credit comes from your source fields and quotes were checked against source.text."
      : "The recipe page could not be fetched again and source.text is empty, so timing quotes were checked against your steps only. Send source.text next time.",
  });
  let parsedUrl = url;
  try {
    parsedUrl = new URL(url).toString();
  } catch {
    return { error: skillsError("source.url", "refused_url", "source.url is not a valid URL: send the full https link.") };
  }
  if (!parsedUrl.startsWith("https://")) {
    return { error: skillsError("source.url", "refused_url", "source.url must be an https link.") };
  }
  return { source: { ...base, url: parsedUrl } };
}

/**
 * The cook-along skill without storage: lenient parse, defaults, strict
 * validation, procedure checks, code schedule, coded review checks and
 * compile. No model calls. Errors carry the path to fix.
 */
export async function prepareCookAlong(raw: unknown, opts: PrepareOptions = {}): Promise<PrepareResult> {
  const warnings: SkillsWarning[] = [];
  const parsed = CookAlongRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      warnings,
      errors: parsed.error.issues.map((issue) => {
        const path = formatPath(issue.path);
        return skillsError(path || "body", issue.path.length === 0 ? "invalid_body" : "invalid_value", issueMessage(issue, path));
      }),
    };
  }
  for (const path of unknownKeyPaths(CookAlongRequestSchema, raw)) {
    warnings.push({ code: "unknown_field", path, message: `${path} is not part of the format and was ignored.` });
  }

  const resolved = await resolveSource(parsed.data, opts.fetchSource ?? ((url) => getRecipeSource(url)), warnings);
  if ("error" in resolved) return { ok: false, errors: [resolved.error], warnings };

  const normalized = normalize(parsed.data, resolved.source);
  warnings.push(...normalized.warnings);
  const { recipe, timeline } = normalized;
  const checked = validateCookAlong(recipe, timeline, { sourceText: resolved.source.text });
  warnings.push(...checked.warnings);
  if (checked.errors.length > 0) return { ok: false, errors: checked.errors, warnings };

  // Backstops: the path-specific checks above should already cover these.
  const errors: SkillsError[] = [];
  for (const check of runProcedureChecks(recipe, timeline)) {
    if (!check.passed) {
      errors.push(skillsError("timeline", "procedure_check", `Procedure rule "${check.name}" failed: ${check.detail}.`));
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  let sched: ScheduleResult;
  try {
    sched = schedule(timeline);
  } catch (error) {
    const message = error instanceof Error ? error.message : "schedule failed";
    return { ok: false, warnings, errors: [skillsError("timeline.tasks", "schedule_failed", `The tasks could not be scheduled (${message}). Fix dependencies and phases.`)] };
  }
  const equipmentProfile = opts.equipmentProfile ?? DEFAULT_EQUIPMENT_PROFILE;
  const review = assistantAuthoredReview({ recipe, timeline, schedule: sched, equipmentProfile });
  if (!review.passed) {
    return {
      ok: false,
      warnings,
      errors: review.checks
        .filter((c) => !c.passed && !c.notRun)
        .map((c) => skillsError("timeline", "review_check", `Review check "${c.name}" failed: ${c.detail}.`)),
    };
  }
  // compile() also applies the deterministic allergen floor once the core
  // stream's src/lib/allergens.ts lands inside it: no second inferrer here.
  const artifact = compile({ recipe, timeline, review, equipmentProfile });
  warnings.push(...formatAdvice(review, timeline));
  return { ok: true, artifact, schedule: sched, review, summary: summarize(artifact, sched), warnings };
}
