import type { CookAlongArtifact, EquipmentProfile } from "./schema/artifact";
import type { CanonicalRecipe } from "./schema/canonical";
import type { TimelineDefinition } from "./schema/timeline";
import { DIETARY_TARGETS } from "./schema/variant";
import type { RecipeJsonLd } from "./intake/url";
import {
  effortFor,
  type EffortOverrides,
  type ProviderName,
  type ReasoningEffort,
  type StructuredChatClient,
  type TokenUsage,
} from "./model";
import { assertTimeFor, STAGE_MIN_MS } from "./model/budget";
import {
  canonicalize,
  type CanonicalizeCheck,
  type CanonicalizeInput,
} from "./stages/canonicalize";
import { procedure, type ProcedureCheck } from "./stages/procedure";
import { review, type ReviewCheck } from "./stages/review";
import { compile } from "./stages/compile";
import { fillFacts, overview, type OverviewResult, type OverviewSource } from "./stages/overview";
import { schedule, type ScheduleResult } from "./scheduler/schedule";
import {
  applyScaling,
  assignScaleRules,
  MAX_SERVINGS,
  MIN_SERVINGS,
  type ScaleFlag,
  unscaledNote,
} from "./stages/scaling";
import { applyDietary } from "./stages/dietary";
import { applyCuisine } from "./stages/cuisine";
import { voice } from "./stages/voice";
import { nativeServingsOf } from "./scaling/native";
import type { FormatWarning } from "./format";
import { reviewNoteTexts } from "./review-notes";
import {
  factsFromJsonLd,
  factsFromRecipe,
  mergeFacts,
  type ConvertEvent,
  type RecipeFacts,
} from "./convert-events";

/** Kitchen capacity assumed when the caller provides none. */
export const DEFAULT_EQUIPMENT_PROFILE: EquipmentProfile = { burners: 4, oven: true };

export interface PipelineOptions {
  provider?: ProviderName;
  equipmentProfile?: EquipmentProfile;
  /** Per-request reasoning efforts (the preview header); env and code defaults fill the rest. */
  efforts?: EffortOverrides;
  /**
   * Progress for a streaming client (convert-events.ts): facts, overview,
   * recipe and procedure as each is ready. Set, it also runs the overview
   * stage alongside canonicalize (or procedure). A listener that throws
   * never breaks the conversion. Unset, the pipeline runs as before.
   */
  onEvent?: (event: ConvertEvent) => void;
  /** The page's schema.org Recipe (URL intake): facts before any model call. */
  jsonLd?: RecipeJsonLd | null;
  /** Fake transports per stage, for offline tests. */
  clients?: {
    overview?: StructuredChatClient;
    canonicalize?: StructuredChatClient;
    procedure?: StructuredChatClient;
    review?: StructuredChatClient;
  };
}

export interface StageReport<Check> {
  checks: Check[];
  usage: TokenUsage;
  /** Verbatim successful model completion (for --record). */
  rawResponse: string;
}

/** The overview call of a streamed conversion (never run without onEvent). */
export interface OverviewReport {
  /** "pending": still running when the cook along was compiled (usage not counted). */
  status: "ok" | "failed" | "pending";
  ms: number;
  usage: TokenUsage;
}

export interface PipelineResult {
  artifact: CookAlongArtifact;
  recipe: CanonicalRecipe;
  schedule: ScheduleResult;
  canonicalize: StageReport<CanonicalizeCheck>;
  procedure: StageReport<ProcedureCheck>;
  review: StageReport<ReviewCheck>;
  /** All model tokens of this conversion, the overview's included once it finished. */
  usageTotal: TokenUsage;
  /**
   * Readable notes for the cook: source text cut to the input window, timing
   * repairs, and the advisory review notes recorded on the artifact.
   */
  warnings: string[];
  /** Coded, non-blocking format warnings (prep coverage, amounts in descriptions). */
  formatWarnings: FormatWarning[];
  /** Wall-clock milliseconds per model stage (0 when a stage did not run). */
  timings: StageTimings;
  /** reasoning_effort sent per model stage that ran (for the logs). */
  efforts: Partial<Record<"overview" | "canonicalize" | "procedure" | "review", ReasoningEffort>>;
  /** Set when the overview stage ran (streaming only). */
  overview?: OverviewReport;
}

export interface StageTimings {
  canonicalizeMs: number;
  procedureMs: number;
  reviewMs: number;
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * Events for one conversion, in the contract's order where timing allows:
 * facts (page facts, or the overview's), overview, recipe, procedure. The
 * overview is sent whenever it arrives before compile; its facts only
 * before the recipe event (the recipe's facts are better). Nothing is sent
 * after close(), and a listener that throws is ignored.
 */
class ConversionProgress {
  private facts: RecipeFacts | null = null;
  private recipeSent = false;
  private closed = false;

  constructor(private readonly onEvent?: (event: ConvertEvent) => void) {}

  get active(): boolean {
    return this.onEvent !== undefined;
  }

  private emit(event: ConvertEvent): void {
    if (!this.onEvent || this.closed) return;
    try {
      this.onEvent(event);
    } catch {
      // A listener (a closed stream) never breaks the conversion.
    }
  }

  /** Progress is best effort: nothing here may fail a conversion. */
  private safely(work: () => void): void {
    if (!this.active || this.closed) return;
    try {
      work();
    } catch {
      // Skip this event; the conversion goes on.
    }
  }

  sourceFacts(read: () => RecipeFacts): void {
    this.safely(() => {
      const facts = read();
      this.facts = facts;
      this.emit({ type: "facts", facts });
    });
  }

  overview(result: OverviewResult): void {
    this.safely(() => {
      if (!this.recipeSent) {
        const merged = fillFacts(this.facts, result.facts);
        if (JSON.stringify(merged) !== JSON.stringify(this.facts)) {
          this.facts = merged;
          this.emit({ type: "facts", facts: merged });
        }
      }
      this.emit({ type: "overview", overview: result.overview });
    });
  }

  recipe(recipe: CanonicalRecipe): void {
    this.safely(() => {
      this.recipeSent = true;
      this.facts = mergeFacts(this.facts, factsFromRecipe(recipe));
      this.emit({ type: "recipe", recipe, facts: this.facts });
    });
  }

  procedure(timeline: TimelineDefinition): void {
    this.safely(() => this.emit({ type: "procedure", timeline }));
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Start the overview call without waiting for it. Its result goes to the
 * progress events; a failure is recorded and otherwise ignored. It runs
 * inside the caller's model budget (deadline, spent flag).
 */
function startOverview(
  source: OverviewSource,
  opts: PipelineOptions,
  effort: ReasoningEffort,
  progress: ConversionProgress,
): OverviewReport {
  const report: OverviewReport = { status: "pending", ms: 0, usage: ZERO_USAGE };
  const mark = Date.now();
  void overview(source, {
    provider: opts.provider,
    client: opts.clients?.overview,
    reasoningEffort: effort,
  }).then(
    (result) => {
      report.status = "ok";
      report.ms = Date.now() - mark;
      report.usage = result.usage;
      try {
        progress.overview(result);
      } catch {
        // Progress is best effort; the conversion goes on.
      }
    },
    () => {
      report.status = "failed";
      report.ms = Date.now() - mark;
    },
  );
  return report;
}

/** The overview's tokens count once it finished; a still-running call is left out. */
function withOverviewUsage(total: TokenUsage, report: OverviewReport | undefined): TokenUsage {
  return report?.status === "ok" ? addUsage(total, report.usage) : total;
}

/**
 * Full conversion pipeline: intake input to Cook Along artifact. Canonicalize
 * and procedure check failures are reported, not fatal; a blocking review
 * failure stops compile and rejects with the readable reasons. Advisory
 * review findings come back as warnings and on the artifact (reviewNotes).
 * With onEvent, progress events stream out as each part is ready and a fast
 * overview call runs alongside canonicalize; nothing ever waits for it.
 */
export async function convertToArtifact(
  input: CanonicalizeInput,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const provider = opts.provider;
  const equipmentProfile = opts.equipmentProfile ?? DEFAULT_EQUIPMENT_PROFILE;
  const progress = new ConversionProgress(opts.onEvent);
  const efforts: PipelineResult["efforts"] = {
    canonicalize: effortFor("canonicalize", opts.efforts),
    procedure: effortFor("procedure", opts.efforts),
    review: effortFor("review", opts.efforts),
  };
  let overviewReport: OverviewReport | undefined;
  try {
    const jsonLd = opts.jsonLd;
    if (jsonLd) {
      progress.sourceFacts(() =>
        factsFromJsonLd(jsonLd, { url: input.source.url ?? null, site: input.source.site ?? null }),
      );
    }
    if (progress.active) {
      efforts.overview = effortFor("overview", opts.efforts);
      overviewReport = startOverview({ input }, opts, efforts.overview, progress);
    }
    assertTimeFor("canonicalize", STAGE_MIN_MS.canonicalize);
    let mark = Date.now();
    const canon = await canonicalize(input, {
      provider,
      client: opts.clients?.canonicalize,
      reasoningEffort: efforts.canonicalize,
    });
    const canonicalizeMs = Date.now() - mark;
    progress.recipe(canon.recipe);
    assertTimeFor("procedure", STAGE_MIN_MS.procedure);
    mark = Date.now();
    const proc = await procedure(canon.recipe, {
      provider,
      client: opts.clients?.procedure,
      reasoningEffort: efforts.procedure,
    });
    const procedureMs = Date.now() - mark;
    progress.procedure(proc.timeline);
    const sched = schedule(proc.timeline);
    assertTimeFor("review", STAGE_MIN_MS.review);
    mark = Date.now();
    const rev = await review(
      {
        recipe: canon.recipe,
        timeline: proc.timeline,
        schedule: sched,
        equipmentProfile,
      },
      { provider, client: opts.clients?.review, reasoningEffort: efforts.review },
    );
    const reviewMs = Date.now() - mark;
    const artifact = compile({
      recipe: canon.recipe,
      timeline: proc.timeline,
      review: rev,
      equipmentProfile,
    });
    progress.close();
    return {
      artifact,
      recipe: canon.recipe,
      schedule: sched,
      canonicalize: {
        checks: canon.checks,
        usage: canon.usage,
        rawResponse: canon.rawResponse,
      },
      procedure: { checks: proc.checks, usage: proc.usage, rawResponse: proc.rawResponse },
      review: { checks: rev.checks, usage: rev.usage, rawResponse: rev.rawResponse },
      usageTotal: withOverviewUsage(
        addUsage(addUsage(canon.usage, proc.usage), rev.usage),
        overviewReport,
      ),
      warnings: [...canon.warnings, ...proc.repairs, ...reviewNoteTexts(artifact)],
      formatWarnings: rev.warnings ?? [],
      timings: { canonicalizeMs, procedureMs, reviewMs },
      efforts,
      ...(overviewReport ? { overview: { ...overviewReport } } : {}),
    };
  } finally {
    progress.close();
  }
}

/**
 * Conversion from an already-canonical recipe (photo confirm screen): skips
 * canonicalize and runs procedure, schedule, review and compile. The
 * canonicalize report is empty because that stage did not run. With
 * onEvent, the recipe's facts and the recipe go out at once and the
 * overview runs alongside procedure.
 */
export async function convertRecipeToArtifact(
  recipe: CanonicalRecipe,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const provider = opts.provider;
  const equipmentProfile = opts.equipmentProfile ?? DEFAULT_EQUIPMENT_PROFILE;
  const progress = new ConversionProgress(opts.onEvent);
  const efforts: PipelineResult["efforts"] = {
    procedure: effortFor("procedure", opts.efforts),
    review: effortFor("review", opts.efforts),
  };
  let overviewReport: OverviewReport | undefined;
  try {
    if (progress.active) {
      progress.sourceFacts(() => factsFromRecipe(recipe));
      progress.recipe(recipe);
      efforts.overview = effortFor("overview", opts.efforts);
      overviewReport = startOverview({ recipe }, opts, efforts.overview, progress);
    }
    assertTimeFor("procedure", STAGE_MIN_MS.procedure);
    let mark = Date.now();
    const proc = await procedure(recipe, {
      provider,
      client: opts.clients?.procedure,
      reasoningEffort: efforts.procedure,
    });
    const procedureMs = Date.now() - mark;
    progress.procedure(proc.timeline);
    const sched = schedule(proc.timeline);
    assertTimeFor("review", STAGE_MIN_MS.review);
    mark = Date.now();
    const rev = await review(
      { recipe, timeline: proc.timeline, schedule: sched, equipmentProfile },
      { provider, client: opts.clients?.review, reasoningEffort: efforts.review },
    );
    const reviewMs = Date.now() - mark;
    const artifact = compile({ recipe, timeline: proc.timeline, review: rev, equipmentProfile });
    progress.close();
    return {
      artifact,
      recipe,
      schedule: sched,
      canonicalize: {
        checks: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawResponse: "",
      },
      procedure: { checks: proc.checks, usage: proc.usage, rawResponse: proc.rawResponse },
      review: { checks: rev.checks, usage: rev.usage, rawResponse: rev.rawResponse },
      usageTotal: withOverviewUsage(addUsage(proc.usage, rev.usage), overviewReport),
      warnings: [...proc.repairs, ...reviewNoteTexts(artifact)],
      formatWarnings: rev.warnings ?? [],
      timings: { canonicalizeMs: 0, procedureMs, reviewMs },
      efforts,
      ...(overviewReport ? { overview: { ...overviewReport } } : {}),
    };
  } finally {
    progress.close();
  }
}

export interface Adjustments {
  servings?: number;
  dietary?: string;
  cuisine?: string;
  voice?: string;
}

export interface AdjustUsage {
  scaling: TokenUsage;
  dietary: TokenUsage;
  cuisine: TokenUsage;
  voice: TokenUsage;
  total: TokenUsage;
}

export interface AdjustedArtifact {
  artifact: CookAlongArtifact;
  scaleFlags: ScaleFlag[];
  /**
   * Notes for the reader: automatic fixes made in code (e.g. step cards
   * reworded for a swap) and amounts a rescale left as printed.
   */
  warnings: string[];
  usage: AdjustUsage;
}

export interface AdjustOptions {
  provider?: ProviderName;
  /** Per-request reasoning efforts (the preview header); env and code defaults fill the rest. */
  efforts?: EffortOverrides;
  /** Fake transports per stage, for offline tests. */
  clients?: {
    scaling?: StructuredChatClient;
    dietary?: StructuredChatClient;
    cuisine?: StructuredChatClient;
    voice?: StructuredChatClient;
  };
}

/**
 * Apply adjustments to a compiled artifact in fixed order: servings, then
 * dietary, then cuisine, then voice. Dietary removals forbid later
 * reintroduction, so an earlier dietary variant still holds. Schedule and
 * artifact id are unchanged: variants never alter timings.
 */
export async function adjustArtifact(
  artifact: CookAlongArtifact,
  adjustments: Adjustments,
  opts: AdjustOptions = {},
): Promise<AdjustedArtifact> {
  const { servings, dietary, cuisine, voice: voiceName } = adjustments;
  if (voiceName !== undefined && voiceName !== "sous") {
    throw new Error(`unsupported voice "${voiceName}": only "sous" is available`);
  }
  if (dietary !== undefined && !(DIETARY_TARGETS as readonly string[]).includes(dietary)) {
    throw new Error(`unknown dietary target "${dietary}"`);
  }
  if (cuisine !== undefined && !cuisine.trim()) {
    throw new Error("cuisine target must not be empty");
  }
  if (servings !== undefined && !(servings >= MIN_SERVINGS && servings <= MAX_SERVINGS)) {
    throw new Error(`servings ${servings} out of range (${MIN_SERVINGS}-${MAX_SERVINGS})`);
  }
  let current = artifact;
  let removedNames: string[] = [];
  let scaleFlags: ScaleFlag[] = [];
  const warnings: string[] = [];
  const usage: AdjustUsage = {
    scaling: ZERO_USAGE,
    dietary: ZERO_USAGE,
    cuisine: ZERO_USAGE,
    voice: ZERO_USAGE,
    total: ZERO_USAGE,
  };
  if (servings !== undefined) {
    const recipe = current.recipe;
    // Rules are judged on the printed quantities at native servings, the
    // same base applyScaling scales from.
    assertTimeFor("scaling", STAGE_MIN_MS.scaling);
    const assigned = await assignScaleRules(
      {
        title: recipe.title,
        servings: nativeServingsOf(recipe, current.changes),
        ingredients: recipe.ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
        })),
        steps: recipe.steps.map((s) => ({ id: s.id, text: s.text })),
      },
      { provider: opts.provider, client: opts.clients?.scaling, efforts: opts.efforts },
    );
    usage.scaling = assigned.usage;
    const applied = applyScaling(current, servings, assigned.rules);
    current = applied.artifact;
    scaleFlags = applied.flags;
    if (applied.unscaled.length > 0) warnings.push(unscaledNote(applied.unscaled));
  }
  if (dietary !== undefined) {
    assertTimeFor("dietary", STAGE_MIN_MS.dietary);
    const applied = await applyDietary(current, dietary, {
      provider: opts.provider,
      client: opts.clients?.dietary,
      efforts: opts.efforts,
      forbiddenNames: removedNames,
    });
    usage.dietary = applied.usage;
    warnings.push(...applied.warnings);
    current = applied.artifact;
    removedNames = applied.removedNames;
  }
  if (cuisine !== undefined) {
    assertTimeFor("cuisine", STAGE_MIN_MS.cuisine);
    const applied = await applyCuisine(current, cuisine, {
      provider: opts.provider,
      client: opts.clients?.cuisine,
      efforts: opts.efforts,
      forbiddenNames: removedNames,
      priorVariant: dietary ?? null,
    });
    usage.cuisine = applied.usage;
    warnings.push(...applied.warnings);
    current = applied.artifact;
    removedNames = applied.removedNames;
  }
  if (voiceName !== undefined) {
    assertTimeFor("voice", STAGE_MIN_MS.voice);
    const voiced = await voice(current.timelineDefinition, {
      provider: opts.provider,
      client: opts.clients?.voice,
      efforts: opts.efforts,
    });
    usage.voice = voiced.usage;
    current = { ...current, timelineDefinition: voiced.timeline };
  }
  usage.total = addUsage(
    addUsage(usage.scaling, usage.dietary),
    addUsage(usage.cuisine, usage.voice),
  );
  return { artifact: current, scaleFlags, warnings, usage };
}
