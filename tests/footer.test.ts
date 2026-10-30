import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../src/app/layout";

describe("site footer", () => {
  it("shows the takedown contact and the privacy note", () => {
    const html = renderToString(createElement(RootLayout, null, ""));
    expect(html).toContain("privacy@textsous.com");
    expect(html).toContain("mailto:privacy@textsous.com");
    expect(html).toContain("never listed");
    expect(html).toContain("never stored");
  });
});
