import { afterEach, describe, expect, it, vi } from "vitest";
import { ENCODE_STEPS, UPLOAD_BUDGET_BYTES } from "../src/app/photo-pages";
import { preparePhotoPages } from "../src/app/photo-resize";

const MB = 1024 * 1024;

function file(name: string, size: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(size)], name, { type });
}

/**
 * A stand-in browser: decoding gives a bitmap of the file's stated size, and
 * a JPEG export weighs width x height x quality bytes.
 */
function fakeBrowser(sizes: Record<string, { width: number; height: number } | "undecodable">) {
  const decodes: Array<{ name: string; options: unknown }> = [];
  const exports: Array<{ width: number; height: number; type: string; quality: number }> = [];
  vi.stubGlobal("createImageBitmap", async (source: File, options?: unknown) => {
    decodes.push({ name: source.name, options });
    const size = sizes[source.name];
    if (!size || size === "undecodable") throw new Error("cannot decode");
    return { width: size.width, height: size.height, close: () => {} };
  });
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
        toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
          exports.push({ width: canvas.width, height: canvas.height, type, quality });
          done(new Blob([new Uint8Array(Math.round(canvas.width * canvas.height * quality))], { type }));
        },
      };
      return canvas;
    },
  });
  return { decodes, exports };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preparePhotoPages", () => {
  it("sends the originals, in order, when the browser cannot decode images", async () => {
    const pages = [file("a.png", 10, "image/png"), file("b.jpg", 20)];
    expect(await preparePhotoPages(pages)).toEqual({ ok: true, files: pages });
  });

  it("refuses originals that pass the 4 MB budget together", async () => {
    const pages = [file("a.jpg", 2.5 * MB), file("b.jpg", 2 * MB)];
    expect(await preparePhotoPages(pages)).toEqual({ ok: false });
  });

  it("decodes upright and exports JPEG 0.82 at most 1600 px on the long edge", async () => {
    const browser = fakeBrowser({ "IMG_1.HEIC": { width: 4032, height: 3024 } });
    const result = await preparePhotoPages([file("IMG_1.HEIC", 3 * MB)]);
    expect(browser.decodes[0].options).toEqual({ imageOrientation: "from-image" });
    expect(browser.exports).toEqual([{ width: 1600, height: 1200, type: "image/jpeg", quality: 0.82 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("IMG_1.jpg");
    expect(result.files[0].type).toBe("image/jpeg");
    expect(result.files[0].size).toBe(Math.round(1600 * 1200 * 0.82));
  });

  it("steps quality down on the largest pages until all three fit 4 MB", async () => {
    const browser = fakeBrowser({
      "p1.jpg": { width: 4032, height: 3024 },
      "p2.jpg": { width: 4032, height: 3024 },
      "p3.jpg": { width: 4032, height: 3024 },
    });
    const result = await preparePhotoPages([file("p1.jpg", 5 * MB), file("p2.jpg", 5 * MB), file("p3.jpg", 5 * MB)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = result.files.reduce((sum, f) => sum + f.size, 0);
    expect(total).toBeLessThanOrEqual(UPLOAD_BUDGET_BYTES);
    expect(result.files.map((f) => f.name)).toEqual(["p1.jpg", "p2.jpg", "p3.jpg"]);
    // 3 x 1.57 MB at 0.82 is over budget; each page drops one step to 0.7.
    expect(browser.exports.map((e) => e.quality)).toEqual([0.82, 0.82, 0.82, 0.7, 0.7, 0.7]);
    expect(ENCODE_STEPS[1].quality).toBe(0.7);
  });

  it("keeps a page the browser cannot decode as it is, next to shrunk ones", async () => {
    fakeBrowser({ "a.jpg": { width: 3000, height: 2000 }, "b.webp": "undecodable" });
    const odd = file("b.webp", 200_000, "image/webp");
    const result = await preparePhotoPages([file("a.jpg", 4 * MB), odd]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files[0].name).toBe("a.jpg");
    expect(result.files[0].type).toBe("image/jpeg");
    expect(result.files[1]).toBe(odd);
  });
});
