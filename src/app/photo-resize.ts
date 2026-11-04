/**
 * Shrink a photo in the browser before upload so phone photos fit under the
 * hosting platform's 4.5 MB request limit (server validation still applies).
 * Long edge at most 2048 px, JPEG around quality 0.85, aiming under 3.5 MB.
 * Small images that already fit are sent untouched (screenshots stay PNG).
 */

export const MAX_EDGE_PX = 2048;
export const TARGET_BYTES = 3.5 * 1024 * 1024;
/** Largest original we try to shrink; bigger files are refused up front. */
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;

/** Target size for a long edge cap. Pure. */
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

/** Encoding attempts, best quality first. Pure. */
export const ENCODE_STEPS: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 2048, quality: 0.85 },
  { maxEdge: 2048, quality: 0.75 },
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1280, quality: 0.7 },
];

function jpegName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "") || "photo";
  return `${base}.jpg`;
}

async function encode(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  const size = planResize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Return a file ready to upload: the original when it already fits (long
 * edge <= 2048 px and <= 3.5 MB), else an upright JPEG re-encode (EXIF
 * orientation applied, metadata dropped). Falls back to the original when
 * the browser cannot decode or encode it.
 */
export async function prepareUploadPhoto(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const fits =
      Math.max(bitmap.width, bitmap.height) <= MAX_EDGE_PX && file.size <= TARGET_BYTES;
    if (fits) return file;
    let smallest: Blob | null = null;
    for (const step of ENCODE_STEPS) {
      const blob = await encode(bitmap, step.maxEdge, step.quality);
      if (!blob) break;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    if (!smallest) return file;
    return new File([smallest], jpegName(file.name), { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
