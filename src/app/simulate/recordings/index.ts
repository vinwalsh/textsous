/**
 * The recordings the simulations replay: two real conversions of our own
 * CC0 recipes, captured from POST /api/convert on production on Nov 4, 2026,
 * and the real /api/photo answer for two photographed cookbook pages. Each
 * loader validates the JSON the way the live page validates the server.
 */
import type { PhotoTranscription } from "../../../lib/intake/photo";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../../../lib/schema/artifact";
import { CanonicalRecipeSchema, type CanonicalRecipe } from "../../../lib/schema/canonical";
import { parseRecording, type Recording } from "../replay";
import muffinsJson from "./lemon-blueberry-muffins.json";
import cornbreadPhotoJson from "./skillet-cornbread-photo.json";
import cornbreadJson from "./skillet-cornbread.json";

export const RECORDED_ON = "Nov 4, 2026";

/** The /demo-sites page the muffins conversion read. */
export const MUFFINS_URL = "https://open.textsous.com/demo-sites/lemon-blueberry-muffins";

/** Lemon Blueberry Muffins by URL: facts 0.2 s, overview 4.2, recipe 24.1, procedure 48.2, done 73.8. */
export function muffinsRecording(): Recording {
  return parseRecording(muffinsJson);
}

/** The finished muffins cook along, as the done event carried it. */
export function muffinsArtifact(): CookAlongArtifact {
  const done = muffinsRecording().find((item) => item.event.type === "done")?.event;
  if (!done || done.type !== "done") throw new Error("The muffins recording has no done event.");
  return CookAlongArtifactSchema.parse(done.artifact);
}

/** Skillet Cornbread from the confirmed photo recipe: facts and recipe 1.6 s, overview 8.1, procedure 19.5, done 46.3. */
export function cornbreadRecording(): Recording {
  return parseRecording(cornbreadJson);
}

export interface PhotoRecording {
  recipe: CanonicalRecipe;
  transcription: PhotoTranscription;
  /** Readable notes for the confirm screen. */
  warnings: string[];
}

/** The real /api/photo answer for the two cornbread pages (public/simulate). */
export function cornbreadPhoto(): PhotoRecording {
  const value = cornbreadPhotoJson as { recipe: unknown; transcription: unknown; warnings?: unknown };
  const recipe = CanonicalRecipeSchema.parse(value.recipe);
  const t = value.transcription as Partial<PhotoTranscription> | null;
  if (!t || typeof t.text !== "string" || t.text.length === 0) {
    throw new Error("The photo recording has no transcription.");
  }
  return {
    recipe,
    transcription: {
      text: t.text,
      book: typeof t.book === "string" ? t.book : null,
      author: typeof t.author === "string" ? t.author : null,
      page: typeof t.page === "number" ? t.page : null,
    },
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((w): w is string => typeof w === "string") : [],
  };
}

/** The two photographed pages, in order (our own CC0 recipe, typeset for the demo). */
export const CORNBREAD_PAGES: ReadonlyArray<{ url: string; name: string }> = [
  { url: "/simulate/cornbread-page-1.jpg", name: "cornbread-page-1.jpg" },
  { url: "/simulate/cornbread-page-2.jpg", name: "cornbread-page-2.jpg" },
];

/** About how long the real transcription of the two pages took before the confirm screen, in seconds. */
export const TRANSCRIBE_SECONDS = 20;
