import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConverterForm from "../src/app/ConverterForm";

describe("converter photo input", () => {
  it("offers take-or-upload choice (no capture attribute forcing the camera)", () => {
    const html = renderToString(
      createElement(ConverterForm, { initialUrl: "", initialSrc: "", initialTab: "photo" }),
    );
    expect(html).toContain('type="file"');
    expect(html).not.toContain("capture");
  });
});
