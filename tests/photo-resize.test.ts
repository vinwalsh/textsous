import { describe, expect, it } from "vitest";
import {
  ENCODE_STEPS,
  MAX_EDGE_PX,
  planResize,
  prepareUploadPhoto,
  TARGET_BYTES,
} from "../src/app/photo-resize";

describe("planResize", () => {
  it("caps the long edge at 2048 px and keeps the aspect ratio", () => {
    expect(planResize(4032, 3024)).toEqual({ width: 2048, height: 1536, scale: 2048 / 4032 });
    expect(planResize(3024, 4032)).toEqual({ width: 1536, height: 2048, scale: 2048 / 4032 });
  });

  it("leaves images that already fit alone", () => {
    expect(planResize(1170, 2532, 4000)).toEqual({ width: 1170, height: 2532, scale: 1 });
    expect(planResize(2048, 1000)).toEqual({ width: 2048, height: 1000, scale: 1 });
  });

  it("starts at JPEG quality 0.85 at 2048 px and aims under 3.5 MB", () => {
    expect(ENCODE_STEPS[0]).toEqual({ maxEdge: MAX_EDGE_PX, quality: 0.85 });
    expect(TARGET_BYTES).toBe(3.5 * 1024 * 1024);
    expect(ENCODE_STEPS.every((s) => s.maxEdge <= MAX_EDGE_PX)).toBe(true);
  });
});

describe("prepareUploadPhoto", () => {
  it("returns the original file when the browser cannot decode images", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    expect(await prepareUploadPhoto(file)).toBe(file);
  });
});
