import type {
  AdvisoryReviewCheck,
  ArtifactReviewNote,
  CookAlongArtifact,
} from "./schema/artifact";
import type { CanonicalRecipe } from "./schema/canonical";
import type { TimelineDefinition } from "./schema/timeline";

/**
 * Advisory review notes: readable sentences for the review judgments that no
 * longer block compile (equipment, step order, tips and cues). Pure and
 * client-safe: the viewer imports the text helpers.
 */

/** What each advisory check looks at, in the cook's words. */
const TOPICS: Record<AdvisoryReviewCheck, string> = {
  equipment_capacity: "how the burners, oven and pans are shared",
  source_relationships: "the order of the steps",
  tips_and_voice: "the tips and done-when cues",
};

const MAX_DETAIL_CHARS = 280;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The model's one-sentence detail with internal ids (task, lane, step,
 * ingredient and resource ids) replaced by the names the cook sees.
 */
export function readableReviewDetail(
  detail: string,
  recipe: Pick<CanonicalRecipe, "ingredients" | "steps">,
  timeline: Pick<TimelineDefinition, "lanes" | "tasks" | "resources">,
): string {
  const names = new Map<string, string>();
  recipe.steps.forEach((step, i) => names.set(step.id, `step ${i + 1}`));
  for (const ingredient of recipe.ingredients) names.set(ingredient.id, ingredient.name);
  for (const resource of timeline.resources) names.set(resource.id, resource.label);
  for (const lane of timeline.lanes) names.set(lane.id, lane.label);
  for (const task of timeline.tasks) names.set(task.id, `"${task.label}"`);
  const ids = [...names.keys()].filter((id) => id.length > 0).sort((a, b) => b.length - a.length);
  let text = detail.trim().replace(/\s+/g, " ");
  if (ids.length > 0) {
    const pattern = new RegExp(`(?<![\\w-])(?:${ids.map(escapeRegExp).join("|")})(?![\\w-])`, "g");
    text = text.replace(pattern, (id) => names.get(id) ?? id);
  }
  if (text.length > MAX_DETAIL_CHARS) text = `${text.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…`;
  return text;
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]["”']?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** One advisory note as the artifact records it. */
export function buildReviewNote(
  check: AdvisoryReviewCheck,
  status: ArtifactReviewNote["status"],
  readableDetail: string,
): ArtifactReviewNote {
  const topic = TOPICS[check];
  const why = readableDetail.trim() ? `: ${asSentence(readableDetail)}` : ".";
  const detail =
    status === "not_judged"
      ? `The automatic review did not check ${topic} for this recipe.`
      : `The automatic review flagged ${topic}${why} Compare with the original recipe if something looks off.`;
  return { check, status, detail };
}

/** The readable notes an artifact carries (none on older artifacts). */
export function reviewNoteTexts(artifact: Pick<CookAlongArtifact, "reviewNotes"> | null | undefined): string[] {
  const notes = artifact?.reviewNotes;
  if (!Array.isArray(notes)) return [];
  return notes
    .map((note) => (typeof note?.detail === "string" ? note.detail.trim() : ""))
    .filter((text) => text.length > 0);
}

/** Note lists joined in order, each sentence once. */
export function mergeNotes(...lists: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const note of list) {
      if (seen.has(note)) continue;
      seen.add(note);
      out.push(note);
    }
  }
  return out;
}
