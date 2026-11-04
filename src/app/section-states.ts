/**
 * Which part of the cook along is coming up, being written or ready, and
 * which parts a queued adjustment will change. Pure: the progressive view
 * (ProgressiveView.tsx) and the finished page (ArtifactViewer.tsx) render
 * from these. No React here.
 */
import type { ConversionState } from "./conversion";

/** Every section of the finished page, in its order. */
export const SECTION_KEYS = [
  "facts",
  "overview",
  "adjust",
  "ingredients",
  "before",
  "prep",
  "steps",
  "timeline",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** Each section's heading on the finished page. */
export const SECTION_TITLES: Record<SectionKey, string> = {
  facts: "About this recipe",
  overview: "What you'll do",
  adjust: "Adjust this recipe",
  ingredients: "Ingredients",
  before: "Before you start",
  prep: "Prep (Mise en Place style)",
  steps: "Steps",
  timeline: "Timeline",
};

/**
 * coming: not started yet (a placeholder, no spinner). working: the server
 * is writing it now (a spinner). checking: written, being checked against
 * the original (content plus a spinner). ready: done.
 */
export type SectionPhase = "coming" | "working" | "checking" | "ready";

export interface SectionState {
  phase: SectionPhase;
  /** One calm muted line under the heading; null when ready. */
  note: string | null;
}

/** The short line on a section that has not started. */
export const COMING_NOTES: Record<SectionKey, string> = {
  facts: "The title, servings and allergens.",
  overview: "A short summary of what you'll cook.",
  adjust: "Change the servings, diet or style once the ingredients are in.",
  ingredients: "Every ingredient with its amount.",
  before: "Time to serve, hands-on time and equipment.",
  prep: "Everything to chop and measure before you cook.",
  steps: "Each step with what to look for.",
  timeline: "Every step on one timeline.",
};

export const CHECKING_NOTE = "Checking against the original…";

const READY: SectionState = { phase: "ready", note: null };

function coming(key: SectionKey): SectionState {
  return { phase: "coming", note: COMING_NOTES[key] };
}

function working(note: string): SectionState {
  return { phase: "working", note };
}

/**
 * Each section's state for a conversion, by the parts that have arrived:
 * before the facts only the facts are being written; with the facts, the
 * summary (until it comes), the ingredients and Before you start; with the
 * recipe, the prep and steps (Before you start waits for them for its time
 * to serve); with the procedure, the prep and steps are checked while the
 * timeline is built; done, everything is ready. The overview may come late
 * or never: it stays "working" until it arrives or the cook along is done.
 * Pure.
 */
export function sectionStates(
  state: Pick<ConversionState, "status" | "facts" | "overview" | "recipe" | "timeline">,
): Record<SectionKey, SectionState> {
  if (state.status === "done") {
    return Object.fromEntries(SECTION_KEYS.map((key) => [key, READY])) as Record<SectionKey, SectionState>;
  }
  const { facts, overview, recipe, timeline } = state;
  const started = facts !== null || recipe !== null;
  return {
    facts: facts ? READY : working("Finding the title, servings and allergens…"),
    overview: overview ? READY : started ? working("Summarizing what you'll cook…") : coming("overview"),
    adjust: recipe ? READY : coming("adjust"),
    ingredients: recipe ? READY : started ? working("Reading the ingredients…") : coming("ingredients"),
    before: timeline
      ? READY
      : recipe
        ? working("Working out the time to serve…")
        : started
          ? working("Listing the equipment…")
          : coming("before"),
    prep: timeline
      ? { phase: "checking", note: CHECKING_NOTE }
      : recipe
        ? working("Laying out the prep…")
        : coming("prep"),
    steps: timeline
      ? { phase: "checking", note: CHECKING_NOTE }
      : recipe
        ? working("Laying out the steps…")
        : coming("steps"),
    timeline: timeline ? working("Fitting every step on one timeline…") : coming("timeline"),
  };
}

/** Whether a section shows a spinner (and aria-busy). Pure. */
export function isBusy(phase: SectionPhase): boolean {
  return phase === "working" || phase === "checking";
}

/** An adjustment as chosen in the panel or asked for by the /embed address. */
export interface PendingChoices {
  servings?: number;
  dietary?: string;
  cuisine?: string;
  sousVoice?: boolean;
}

/** The sections an adjustment rewrites, in page order. */
const SCALED: readonly SectionKey[] = ["facts", "ingredients", "prep", "steps", "timeline"];
const REWORDED: readonly SectionKey[] = ["prep", "steps", "timeline"];

/**
 * The sections a queued adjustment will change, which say "Before your
 * changes" until it applies. Servings, a diet or a style change the facts
 * (servings line, allergens), the ingredients, prep, steps and timeline; SOUS
 * voice rewords the prep, steps and timeline only. `base` is the recipe's
 * servings, or null while unknown (a servings choice then counts as a
 * change). Pure.
 */
export function adjustedSections(choices: PendingChoices | null | undefined, base: number | null): SectionKey[] {
  if (!choices) return [];
  const servings = choices.servings !== undefined && (base === null || choices.servings !== base);
  const recipe = servings || Boolean(choices.dietary) || Boolean(choices.cuisine?.trim());
  if (recipe) return [...SCALED];
  return choices.sousVoice ? [...REWORDED] : [];
}

export const BEFORE_CHANGES = "Before your changes";
