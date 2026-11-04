/**
 * The photo tab's pages and upload budget. Pure: no DOM, no React, so every
 * rule here is unit-tested. One recipe may run over up to 3 photos; the
 * browser shrinks each one before upload (photo-resize.ts) so the whole
 * request stays under the hosting platform's 4.5 MB body limit (the server
 * refuses over 4.4 MB, and over 4 MB for any one photo).
 */

/** Photos of one recipe in one request (the server's MAX_PHOTOS). */
export const MAX_PHOTO_PAGES = 3;

export const PHOTO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Largest original we try to shrink; bigger files are refused up front. */
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;

/** Long edge of an upload, in px. */
export const MAX_EDGE_PX = 1600;

/** Encoding attempts for a page, best first: quality steps down to fit the budget. */
export const ENCODE_STEPS: ReadonlyArray<{ maxEdge: number; quality: number }> = [
  { maxEdge: MAX_EDGE_PX, quality: 0.82 },
  { maxEdge: MAX_EDGE_PX, quality: 0.7 },
  { maxEdge: MAX_EDGE_PX, quality: 0.6 },
  { maxEdge: 1280, quality: 0.6 },
];

/** Every page together, under the server's caps with room for the multipart framing. */
export const UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024;

export const PHOTO_HELP =
  "Up to 3 photos of one recipe, for a recipe that runs over more than one page.";

/** "Page 1", "Page 2", ... for a 0-based index. */
export function pageLabel(index: number): string {
  return `Page ${index + 1}`;
}

/** Target size for a long-edge cap, keeping the aspect ratio. */
export function planResize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number; scale: number } {
  const longEdge = Math.max(width, height);
  if (!(longEdge > maxEdge)) return { width, height, scale: 1 };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Split newly picked files into the ones that still fit after `current`
 * pages, in the order given, and how many were left out.
 */
export function fitPages<T>(
  current: number,
  incoming: readonly T[],
  max = MAX_PHOTO_PAGES,
): { accepted: T[]; dropped: number } {
  const room = Math.max(0, max - current);
  const accepted = incoming.slice(0, room);
  return { accepted, dropped: incoming.length - accepted.length };
}

/** The list without the page whose id matches; the others keep their order. */
export function withoutPage<T extends { id: string }>(pages: readonly T[], id: string): T[] {
  return pages.filter((page) => page.id !== id);
}

export interface PhotoPickProblem {
  title: string;
  detail: string;
}

/** Why a picked or pasted file cannot be a page, or null when it can. */
export function checkPickedFile(file: { type: string; size: number }): PhotoPickProblem | null {
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      title: "That photo won't work",
      detail: "PNG, JPEG or WebP only — screenshots usually paste as PNG.",
    };
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    return {
      title: "That photo is too big",
      detail: "Photos must be under 30 MB. Try a smaller image.",
    };
  }
  return null;
}

/** Minimal clipboard-item shape; matches DataTransferItem structurally. */
export interface PastedItem {
  type: string;
  getAsFile: () => File | null;
}

/** First pasted image file, or null when the paste holds no usable image. */
export function firstPastedFile(items: readonly PastedItem[]): File | null {
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** Note for photos left out because the list was full, or null. */
export function droppedNote(dropped: number): string | null {
  if (dropped <= 0) return null;
  return dropped === 1
    ? "Up to 3 photos of one recipe: 1 photo was left out."
    : `Up to 3 photos of one recipe: ${dropped} photos were left out.`;
}

/** Label of the control that adds pages. */
export function addPagesLabel(count: number): string {
  return count === 0 ? "Choose photos" : "Add another page";
}

/** Label of the transcribe button. */
export function transcribeLabel(count: number, busy: boolean): string {
  if (busy) return "Transcribing…";
  return count > 1 ? `Transcribe ${count} photos` : "Transcribe photo";
}

export function totalBytes(pages: readonly { size: number }[]): number {
  return pages.reduce((sum, page) => sum + page.size, 0);
}

/**
 * The page to encode again one quality step down: the largest page that
 * still has a step left. Null once the pages fit the budget, or when none
 * can shrink further (the caller then refuses the upload).
 */
export function nextPageToShrink(
  pages: readonly { size: number; step: number }[],
  budget = UPLOAD_BUDGET_BYTES,
  stepCount = ENCODE_STEPS.length,
): number | null {
  if (totalBytes(pages) <= budget) return null;
  let pick: number | null = null;
  pages.forEach((page, i) => {
    if (page.step + 1 >= stepCount) return;
    if (pick === null || page.size > pages[pick].size) pick = i;
  });
  return pick;
}

/** Upload name for a re-encoded page. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "") || "photo";
  return `${base}.jpg`;
}
