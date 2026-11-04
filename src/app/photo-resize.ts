/**
 * Shrink the photo pages in the browser before upload: each page is decoded
 * upright (EXIF orientation applied), drawn at most 1600 px on the long edge
 * and exported as JPEG quality 0.82, which also drops the photo's metadata.
 * When the pages together pass the 4 MB budget, the largest page steps down
 * in quality until they fit. A page the browser cannot decode is sent as it
 * is when it fits. The rules live in photo-pages.ts; this is the DOM part.
 */

import {
  ENCODE_STEPS,
  jpegName,
  nextPageToShrink,
  planResize,
  totalBytes,
  UPLOAD_BUDGET_BYTES,
} from "./photo-pages";

export type PreparedPhotos = { ok: true; files: File[] } | { ok: false };

async function decode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older engines reject the option; they apply EXIF orientation anyway.
  }
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/** One page as JPEG at an encode step, or null when the browser cannot. */
async function encode(file: File, step: number): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await decode(file);
  if (!bitmap) return null;
  const canvas = document.createElement("canvas");
  try {
    const { maxEdge, quality } = ENCODE_STEPS[step];
    const size = planResize(bitmap.width, bitmap.height, maxEdge);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no transparency: a transparent screenshot gets a white page.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  } catch {
    return null;
  } finally {
    bitmap.close();
    // Phones keep canvas memory until it is shrunk.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * The files to upload, in page order, or { ok: false } when they cannot fit
 * the 4 MB budget even after shrinking.
 */
export async function preparePhotoPages(files: readonly File[]): Promise<PreparedPhotos> {
  const lastStep = ENCODE_STEPS.length - 1;
  const pages: Array<{ blob: Blob; size: number; step: number; encoded: boolean }> = [];
  // One page at a time: a decoded phone photo holds tens of MB.
  for (const file of files) {
    const blob = await encode(file, 0);
    pages.push(
      blob
        ? { blob, size: blob.size, step: 0, encoded: true }
        : { blob: file, size: file.size, step: lastStep, encoded: false },
    );
  }
  for (let i = nextPageToShrink(pages); i !== null; i = nextPageToShrink(pages)) {
    const page = pages[i];
    page.step += 1;
    const blob = await encode(files[i], page.step);
    if (blob && blob.size < page.size) {
      page.blob = blob;
      page.size = blob.size;
    }
  }
  if (totalBytes(pages) > UPLOAD_BUDGET_BYTES) return { ok: false };
  return {
    ok: true,
    files: pages.map((page, i) =>
      page.encoded ? new File([page.blob], jpegName(files[i].name), { type: "image/jpeg" }) : files[i],
    ),
  };
}
