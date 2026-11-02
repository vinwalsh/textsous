import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConverterForm, { firstPastedFile } from "../src/app/ConverterForm";

function pasteItem(type: string, file: File | null): { type: string; getAsFile: () => File | null } {
  return { type, getAsFile: () => file };
}

describe("converter photo input", () => {
  it("offers take-or-upload choice (no capture attribute forcing the camera)", () => {
    const html = renderToString(
      createElement(ConverterForm, { initialUrl: "", initialSrc: "", initialTab: "photo" }),
    );
    expect(html).toContain('type="file"');
    expect(html).not.toContain("capture");
  });

  it("tells cooks they can paste a screenshot", () => {
    const html = renderToString(
      createElement(ConverterForm, { initialUrl: "", initialSrc: "", initialTab: "photo" }),
    );
    expect(html).toContain("paste a screenshot");
  });
});

describe("firstPastedFile", () => {
  const shot = new File(["bytes"], "shot.png", { type: "image/png" });

  it("returns the first pasted image, skipping text", () => {
    expect(
      firstPastedFile([
        pasteItem("text/plain", null),
        pasteItem("image/png", shot),
        pasteItem("image/jpeg", shot),
      ]),
    ).toBe(shot);
  });

  it("returns null when the paste holds no image", () => {
    expect(firstPastedFile([pasteItem("text/plain", null)])).toBeNull();
    expect(firstPastedFile([])).toBeNull();
  });

  it("skips items whose file is unavailable", () => {
    expect(
      firstPastedFile([pasteItem("image/png", null), pasteItem("image/png", shot)]),
    ).toBe(shot);
  });
});
