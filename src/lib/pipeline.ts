import type { CookAlongArtifact, EquipmentProfile } from "./schema/artifact";
import type { CanonicalRecipe } from "./schema/canonical";
import { DIETARY_TARGETS } from "./schema/variant";
import type { ProviderName, StructuredChatClient, TokenUsage } from "./model";
import {
  canonicalize,
  type CanonicalizeCheck,
  type CanonicalizeInput,
} from "./stages/canonicalize";
import { procedure, type ProcedureCheck } from "./stages/procedure";
import { review, type ReviewCheck } from "./stages/review";
import { compile } from "./stages/compile";
import { schedule, type ScheduleResult } from "./scheduler/schedule";
import {
  applyScaling,
  assignScaleRules,
  MAX_SERVINGS,
  MIN_SERVINGS,
  type ScaleFlag,
} from "./stages/scaling";
import { applyDietary } from "./stages/dietary";
import { applyCuisine } from "./stages/cuisine";
import { voice } from "./stages/voice";

/** Kitchen capacity assumed when the caller provides none. */
export const DEFAULT_EQUIPMENT_PROFILE: EquipmentProfile = { burners: 4, oven: true };

export interface PipelineOptions {
  provider?: ProviderName;
  equipmentProfile?: EquipmentProfile;
}

export interface StageReport<Check> {
  checks: Check[];
  usage: TokenUsage;
  /** Verbatim successful model completion (for --record). */
  rawResponse: string;
}

export interface PipelineResult {
  artifact: CookAlongArtifact;
  recipe: CanonicalRecipe;
  schedule: ScheduleResult;
  canonicalize: StageReport<CanonicalizeCheck>;
  procedure: StageReport<ProcedureCheck>;
  review: StageReport<ReviewCheck>;
  usageTotal: TokenUsage;
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Full conversion pipeline: intake input to Cook Along artifact. Canonicalize
 * and procedure check failures are reported, not fatal; a failed review
 * blocks compile and rejects with the readable reasons.
 */
export async function convertToArtifact(
  input: CanonicalizeInput,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const provider = opts.provider;
  const equipmentProfile = opts.equipmentProfile ?? DEFAULT_EQUIPMENT_PROFILE;
  const canon = await canonicalize(input, { provider });
  const proc = await procedure(canon.recipe, { provider });
  const sched = schedule(proc.timeline);
  const rev = await review(
    {
      recipe: canon.recipe,
      timeline: proc.timeline,
      schedule: sched,
      equipmentProfile,
    },
    { provider },
  );
  const artifact = compile({
    recipe: canon.recipe,
    timeline: proc.timeline,
    review: rev,
    equipmentProfile,
  });
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
    usageTotal: addUsage(addUsage(canon.usage, proc.usage), rev.usage),
  };
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
  usage: AdjustUsage;
}

export interface AdjustOptions {
  provider?: ProviderName;
  /** Fake transports per stage, for offline tests. */
  clients?: {
    scaling?: StructuredChatClient;
    dietary?: StructuredChatClient;
    cuisine?: StructuredChatClient;
    voice?: StructuredChatClient;
  };
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

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
  const usage: AdjustUsage = {
    scaling: ZERO_USAGE,
    dietary: ZERO_USAGE,
    cuisine: ZERO_USAGE,
    voice: ZERO_USAGE,
    total: ZERO_USAGE,
  };
  if (servings !== undefined) {
    const recipe = current.recipe;
    const assigned = await assignScaleRules(
      {
        title: recipe.title,
        servings: recipe.servings,
        ingredients: recipe.ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
        })),
        steps: recipe.steps.map((s) => ({ id: s.id, text: s.text })),
      },
      { provider: opts.provider, client: opts.clients?.scaling },
    );
    usage.scaling = assigned.usage;
    const applied = applyScaling(current, servings, assigned.rules);
    current = applied.artifact;
    scaleFlags = applied.flags;
  }
  if (dietary !== undefined) {
    const applied = await applyDietary(current, dietary, {
      provider: opts.provider,
      client: opts.clients?.dietary,
      forbiddenNames: removedNames,
    });
    usage.dietary = applied.usage;
    current = applied.artifact;
    removedNames = applied.removedNames;
  }
  if (cuisine !== undefined) {
    const applied = await applyCuisine(current, cuisine, {
      provider: opts.provider,
      client: opts.clients?.cuisine,
      forbiddenNames: removedNames,
      priorVariant: dietary ?? null,
    });
    usage.cuisine = applied.usage;
    current = applied.artifact;
    removedNames = applied.removedNames;
  }
  if (voiceName !== undefined) {
    const voiced = await voice(current.timelineDefinition, {
      provider: opts.provider,
      client: opts.clients?.voice,
    });
    usage.voice = voiced.usage;
    current = { ...current, timelineDefinition: voiced.timeline };
  }
  usage.total = addUsage(
    addUsage(usage.scaling, usage.dietary),
    addUsage(usage.cuisine, usage.voice),
  );
  return { artifact: current, scaleFlags, usage };
}
