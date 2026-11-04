import { describe, expect, it } from "vitest";
import {
  addPagesLabel,
  checkPickedFile,
  droppedNote,
  ENCODE_STEPS,
  fitPages,
  jpegName,
  MAX_EDGE_PX,
  MAX_ORIGINAL_BYTES,
  MAX_PHOTO_PAGES,
  nextPageToShrink,
  pageLabel,
  PHOTO_HELP,
  planResize,
  totalBytes,
  transcribeLabel,
  UPLOAD_BUDGET_BYTES,
  withoutPage,
} from "../src/app/photo-pages";
import { MAX_PHOTO_BODY_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "../src/lib/intake/photo";

const MB = 1024 * 1024;

describe("the page list", () => {
  it("adds picked photos in order until 3", () => {
    expect(fitPages(0, ["a", "b"])).toEqual({ accepted: ["a", "b"], dropped: 0 });
    expect(fitPages(2, ["c", "d", "e"])).toEqual({ accepted: ["c"], dropped: 2 });
    expect(fitPages(3, ["f"])).toEqual({ accepted: [], dropped: 1 });
    expect(fitPages(0, ["a", "b", "c", "d"])).toEqual({ accepted: ["a", "b", "c"], dropped: 1 });
  });

  it("removes one page and keeps the others in order", () => {
    const pages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    expect(withoutPage(pages, "p2")).toEqual([{ id: "p1" }, { id: "p3" }]);
    expect(withoutPage(pages, "nope")).toEqual(pages);
  });

  it("matches the server's photo count", () => {
    expect(MAX_PHOTO_PAGES).toBe(3);
    expect(MAX_PHOTO_PAGES).toBe(MAX_PHOTOS);
  });

  it("labels pages, the add control and the transcribe button", () => {
    expect([0, 1, 2].map(pageLabel)).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(addPagesLabel(0)).toBe("Choose photos");
    expect(addPagesLabel(1)).toBe("Add another page");
    expect(transcribeLabel(1, false)).toBe("Transcribe photo");
    expect(transcribeLabel(3, false)).toBe("Transcribe 3 photos");
    expect(transcribeLabel(2, true)).toBe("Transcribing…");
    expect(PHOTO_HELP).toBe(
      "Up to 3 photos of one recipe, for a recipe that runs over more than one page.",
    );
  });

  it("says calmly how many photos were left out", () => {
    expect(droppedNote(0)).toBeNull();
    expect(droppedNote(1)).toBe("Up to 3 photos of one recipe: 1 photo was left out.");
    expect(droppedNote(2)).toBe("Up to 3 photos of one recipe: 2 photos were left out.");
  });
});

describe("checkPickedFile", () => {
  it("takes PNG, JPEG and WebP up to 30 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(checkPickedFile({ type, size: 2 * MB })).toBeNull();
    }
    expect(checkPickedFile({ type: "image/jpeg", size: MAX_ORIGINAL_BYTES })).toBeNull();
  });

  it("refuses other types and huge originals with plain copy", () => {
    expect(checkPickedFile({ type: "image/gif", size: 10 })?.detail).toMatch(/PNG, JPEG or WebP only/);
    expect(checkPickedFile({ type: "image/heic", size: 10 })?.title).toBe("That photo won't work");
    expect(checkPickedFile({ type: "image/png", size: MAX_ORIGINAL_BYTES + 1 })?.title).toBe(
      "That photo is too big",
    );
  });
});

describe("target dimensions", () => {
  it("caps the long edge at 1600 px and keeps the aspect ratio", () => {
    expect(MAX_EDGE_PX).toBe(1600);
    expect(planResize(4032, 3024)).toEqual({ width: 1600, height: 1200, scale: 1600 / 4032 });
    expect(planResize(3024, 4032)).toEqual({ width: 1200, height: 1600, scale: 1600 / 4032 });
    expect(planResize(1170, 2532)).toEqual({ width: 739, height: 1600, scale: 1600 / 2532 });
  });

  it("leaves images that already fit alone", () => {
    expect(planResize(1200, 900)).toEqual({ width: 1200, height: 900, scale: 1 });
    expect(planResize(1600, 1000)).toEqual({ width: 1600, height: 1000, scale: 1 });
    expect(planResize(1170, 2532, 4000)).toEqual({ width: 1170, height: 2532, scale: 1 });
  });

  it("starts at JPEG quality 0.82 at 1600 px and only steps down", () => {
    expect(ENCODE_STEPS[0]).toEqual({ maxEdge: 1600, quality: 0.82 });
    for (let i = 1; i < ENCODE_STEPS.length; i += 1) {
      expect(ENCODE_STEPS[i].quality).toBeLessThanOrEqual(ENCODE_STEPS[i - 1].quality);
      expect(ENCODE_STEPS[i].maxEdge).toBeLessThanOrEqual(ENCODE_STEPS[i - 1].maxEdge);
    }
  });

  it("names a re-encoded page .jpg", () => {
    expect(jpegName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegName("page.png")).toBe("page.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });
});

describe("the size budget", () => {
  it("keeps every upload under the server's caps", () => {
    expect(UPLOAD_BUDGET_BYTES).toBe(4 * MB);
    expect(UPLOAD_BUDGET_BYTES).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(UPLOAD_BUDGET_BYTES).toBeLessThan(MAX_PHOTO_BODY_BYTES);
  });

  it("does nothing while the pages fit", () => {
    expect(nextPageToShrink([{ size: MB, step: 0 }, { size: MB, step: 0 }])).toBeNull();
    expect(nextPageToShrink([{ size: 4 * MB, step: 0 }])).toBeNull();
  });

  it("shrinks the largest page that still has a step left", () => {
    const pages = [
      { size: 1.5 * MB, step: 0 },
      { size: 2 * MB, step: 0 },
      { size: 1 * MB, step: 0 },
    ];
    expect(totalBytes(pages)).toBe(4.5 * MB);
    expect(nextPageToShrink(pages)).toBe(1);
    const last = ENCODE_STEPS.length - 1;
    expect(nextPageToShrink([{ ...pages[0] }, { size: 2 * MB, step: last }, { ...pages[2] }])).toBe(0);
  });

  it("gives up when no page can shrink further", () => {
    const last = ENCODE_STEPS.length - 1;
    expect(nextPageToShrink([{ size: 3 * MB, step: last }, { size: 2 * MB, step: last }])).toBeNull();
  });
});
