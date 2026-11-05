/**
 * The progressive conversion on the client (M8): a pure reducer over the
 * NDJSON events of POST /api/convert (src/lib/convert-events.ts), and the
 * request that feeds it. A JSON answer (an error found before the stream
 * starts, or a server that does not stream) is read the way the page always
 * read it. No React here: the hook in useConversion.ts wraps it.
 */
import {
  CONVERT_EVENTS_MEDIA_TYPE,
  factsFromRecipe,
  mergeFacts,
  readEvents,
  type ConvertEvent,
  type RecipeFacts,
  type RecipeOverview,
} from "../lib/convert-events";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../lib/schema/artifact";
import { CanonicalRecipeSchema, type CanonicalRecipe } from "../lib/schema/canonical";
import { TimelineDefinitionSchema, type TimelineDefinition } from "../lib/schema/timeline";
import { API_TIMEOUT_MS, convertNotices, friendlyError, type FriendlyError } from "./request";

/** What POST /api/convert takes: one of a recipe URL, pasted text or a confirmed recipe. */
export type ConvertBody = { url: string } | { text: string } | { recipe: CanonicalRecipe };

export type ConversionStatus = "idle" | "working" | "done" | "failed";

export interface ConversionState {
  status: ConversionStatus;
  /** The recipe page being converted (URL conversions only), for the error copy. */
  recipeUrl: string | null;
  facts: RecipeFacts | null;
  overview: RecipeOverview | null;
  recipe: CanonicalRecipe | null;
  /** Prep, steps and tips before the review has checked them. */
  timeline: TimelineDefinition | null;
  /** The finished, validated cook along (status "done"). */
  artifact: CookAlongArtifact | null;
  cached: boolean;
  /** The conversion's warnings as display strings. */
  notices: string[];
  /** Friendly copy for a failed conversion (status "failed"). */
  error: FriendlyError | null;
}

export type ConversionAction =
  | ConvertEvent
  | { type: "start"; body: ConvertBody }
  | { type: "failed"; error: FriendlyError }
  | { type: "reset" };

export const initialConversionState: ConversionState = {
  status: "idle",
  recipeUrl: null,
  facts: null,
  overview: null,
  recipe: null,
  timeline: null,
  artifact: null,
  cached: false,
  notices: [],
  error: null,
};

/** Same copy as before streaming, when the finished artifact does not validate. */
export const INVALID_ARTIFACT_MESSAGE = "The server returned an invalid artifact. Try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Enough of RecipeFacts to merge and render without throwing. */
function isFacts(value: unknown): value is RecipeFacts {
  return (
    isRecord(value) &&
    isRecord(value.source) &&
    isRecord(value.minutes) &&
    Array.isArray(value.allergens) &&
    Array.isArray(value.traces)
  );
}

function isOverview(value: unknown): value is RecipeOverview {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    Array.isArray(value.components) &&
    value.components.every((c) => isRecord(c) && typeof c.name === "string" && typeof c.how === "string")
  );
}

function validRecipe(value: unknown): CanonicalRecipe | null {
  const parsed = CanonicalRecipeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * friendlyError for a failed conversion, with the options the page has
 * always passed: the 429 reason, and for a URL its address (the daily-cap
 * link) and "may still finish" (the server keeps converting and caches it).
 */
export function conversionError(
  status: number | null,
  message: string,
  opts: { recipeUrl: string | null; reason?: unknown; timeout?: boolean },
): FriendlyError {
  const recipeUrl = opts.recipeUrl ?? undefined;
  return friendlyError(status, message, {
    timeout: opts.timeout === true,
    ...(typeof opts.reason === "string" ? { reason: opts.reason } : {}),
    recipeUrl,
    mayFinish: recipeUrl !== undefined,
  });
}

/**
 * One step of the conversion. Pure. Facts merge with mergeFacts (allergens
 * only grow); the recipe event brings facts too; done validates the
 * artifact; events after done or an error are ignored.
 */
export function reduceConversion(state: ConversionState, action: ConversionAction): ConversionState {
  switch (action.type) {
    case "start": {
      // A confirmed photo recipe is known before the server answers.
      const recipe = "recipe" in action.body ? validRecipe(action.body.recipe) : null;
      return {
        ...initialConversionState,
        status: "working",
        recipeUrl: "url" in action.body ? action.body.url : null,
        recipe,
        facts: recipe ? factsFromRecipe(recipe) : null,
      };
    }
    case "reset":
      return initialConversionState;
    case "failed":
      return state.status === "working" ? { ...state, status: "failed", error: action.error } : state;
  }
  if (state.status !== "working") return state;
  switch (action.type) {
    case "facts":
      return isFacts(action.facts) ? { ...state, facts: mergeFacts(state.facts, action.facts) } : state;
    case "overview":
      return isOverview(action.overview) ? { ...state, overview: action.overview } : state;
    case "recipe": {
      const recipe = validRecipe(action.recipe);
      const facts = isFacts(action.facts) ? mergeFacts(state.facts, action.facts) : state.facts;
      return { ...state, recipe: recipe ?? state.recipe, facts };
    }
    case "procedure": {
      const timeline = TimelineDefinitionSchema.safeParse(action.timeline);
      return timeline.success ? { ...state, timeline: timeline.data } : state;
    }
    case "done": {
      const valid = CookAlongArtifactSchema.safeParse(action.artifact);
      if (!valid.success) {
        return { ...state, status: "failed", error: friendlyError(200, INVALID_ARTIFACT_MESSAGE) };
      }
      return {
        ...state,
        status: "done",
        artifact: valid.data,
        cached: action.cached === true,
        notices: convertNotices(action.warnings),
        error: null,
      };
    }
    case "error":
      return {
        ...state,
        status: "failed",
        error: conversionError(typeof action.status === "number" ? action.status : 500, action.error ?? "", {
          recipeUrl: state.recipeUrl,
          reason: action.reason,
        }),
      };
    default:
      // An event type from a newer server: nothing to show for it.
      return state;
  }
}

/**
 * The cooking line's live status, by the furthest part that has arrived. The
 * summary usually lands while the ingredients are still being read, and one
 * model call writes the prep and the steps together.
 */
export const CONVERSION_STAGES = [
  "Reading the recipe",
  "Summarizing",
  "Reading the ingredients",
  "Laying out the prep and steps",
  "Checking against the original",
  "Building your Cook Along",
] as const;

export type ConversionStage = (typeof CONVERSION_STAGES)[number];

/** Index into CONVERSION_STAGES for a state. Pure. */
export function conversionStageIndex(
  state: Pick<ConversionState, "status" | "facts" | "overview" | "recipe" | "timeline">,
): number {
  if (state.status === "done") return 5;
  if (state.timeline) return 4;
  if (state.recipe) return 3;
  if (state.overview) return 2;
  if (state.facts) return 1;
  return 0;
}

export function conversionStage(
  state: Pick<ConversionState, "status" | "facts" | "overview" | "recipe" | "timeline">,
): ConversionStage {
  return CONVERSION_STAGES[conversionStageIndex(state)];
}

/**
 * Where a conversion's events come from instead of POST /api/convert: a
 * replay of a recording (/simulate). It paces itself, so the client wait
 * does not apply, and it stops when `signal` aborts.
 */
export type ConversionEventSource = (body: ConvertBody, signal: AbortSignal) => AsyncIterable<ConvertEvent>;

export interface RunConversionOptions {
  fetchImpl?: typeof fetch;
  /** Client wait for the whole conversion, stream included (default 430 s). */
  timeoutMs?: number;
  /** Stops reading (the page moved on); the server keeps converting. */
  signal?: AbortSignal;
  /** Events from somewhere other than the server; the live path is untouched when absent. */
  source?: ConversionEventSource;
}

/**
 * POST /api/convert asking for NDJSON and pass every step to `dispatch`.
 * Resolves with the final state (done, failed, or still working if `signal`
 * stopped it). Never throws.
 */
export async function runConversion(
  body: ConvertBody,
  dispatch: (action: ConversionAction) => void,
  { fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS, signal, source }: RunConversionOptions = {},
): Promise<ConversionState> {
  let state = initialConversionState;
  const apply = (action: ConversionAction): void => {
    state = reduceConversion(state, action);
    dispatch(action);
  };
  apply({ type: "start", body });
  const recipeUrl = state.recipeUrl;
  const controller = new AbortController();
  let timedOut = false;
  // A source paces itself: the client wait is for the server alone.
  const timer = source
    ? null
    : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
  const stop = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", stop);
  // Every event in order; events that end without done or error are a dropped connection.
  const drain = async (events: AsyncIterable<ConvertEvent>): Promise<ConversionState> => {
    for await (const event of events) {
      apply(event);
      if (state.status !== "working") break;
    }
    if (state.status === "working" && !controller.signal.aborted) {
      apply({ type: "failed", error: conversionError(null, "", { recipeUrl }) });
    }
    return state;
  };
  try {
    if (source) return await drain(source(body, controller.signal));
    const response = await fetchImpl("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json", accept: CONVERT_EVENTS_MEDIA_TYPE },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && response.body && type.includes(CONVERT_EVENTS_MEDIA_TYPE)) {
      return await drain(readEvents(response.body));
    }
    // JSON: an error found before the stream started, or a server that does not stream.
    const data: unknown = await response.json().catch(() => null);
    const json = isRecord(data) ? data : null;
    if (!response.ok || !json || json.artifact === undefined) {
      apply({
        type: "failed",
        error: conversionError(response.status, typeof json?.error === "string" ? json.error : "", {
          recipeUrl,
          reason: json?.reason,
        }),
      });
      return state;
    }
    apply({
      type: "done",
      artifact: json.artifact as CookAlongArtifact,
      cached: json.cached === true,
      warnings: Array.isArray(json.warnings) ? json.warnings : [],
    });
    return state;
  } catch {
    // A dropped connection, the 430 s wait running out, or a garbled line.
    if (state.status === "working" && (timedOut || !signal?.aborted)) {
      apply({ type: "failed", error: conversionError(null, "", { recipeUrl, timeout: timedOut }) });
    }
    return state;
  } finally {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
