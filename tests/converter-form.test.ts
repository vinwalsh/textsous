import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConverterForm, { firstPastedFile, offersPasteText } from "../src/app/ConverterForm";
import ErrorBox from "../src/app/ErrorBox";
import { friendlyError } from "../src/app/request";

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

describe("the paste-text button (fix-pass review)", () => {
  const blocked = friendlyError(422, "compile blocked: method_and_safety: the chicken sits out");
  const render = (onAction?: () => void) => renderToString(createElement(ErrorBox, { error: blocked, onAction }));

  it("is not offered on the Pasted text tab, where it would only clear the error", () => {
    expect(offersPasteText("text")).toBe(false);
    expect(offersPasteText("url")).toBe(true);
    expect(offersPasteText("photo")).toBe(true);
    const onText = render(undefined);
    expect(onText).not.toContain("Paste the recipe text instead");
    expect(onText).toContain("<summary>Details</summary>");
    expect(render(() => {})).toContain("Paste the recipe text instead");
  });

  it("is wired into the URL and Pasted text form", () => {
    expect(readFileSync("src/app/ConverterForm.tsx", "utf8")).toContain(
      "<ErrorBox error={error} onAction={offersPasteText(tab) ? switchToPaste : undefined} />",
    );
  });
});
