import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../src/app/layout";
import PhotoConfirm from "../src/app/PhotoConfirm";
import { friendlyError, submitButtonClass } from "../src/app/request";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";

// Visual QA at 390 and 1280 px (qa-1..qa-13): contrast, tap targets, the
// timeline's lane names, the file picker, the daily-cap buttons and footer.

const css = readFileSync("src/app/globals.css", "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("contrast", () => {
  it("darkens muted text on unattended cards and the prompt card (qa-1, qa-7)", () => {
    expect(rule(".task-card.unattended")).toContain("--ts-muted: #6B635E");
    const assistants = readFileSync("src/app/assistants/assistants.module.css", "utf8");
    expect(assistants).toMatch(/\.promptCard \{[^}]*--ts-muted: #6b635e/);
  });

  it("gives form fields a 3:1 edge (qa-8)", () => {
    expect(css).toMatch(/textarea,\nselect \{[^}]*border: 1px solid #958C85/);
  });
});

describe("tap targets of at least 44 px", () => {
  it("covers tabs, the tips toggle, timer buttons, check rows, summaries and the header (qa-5, qa-6)", () => {
    for (const selector of [".tab", ".mode-option", ".timer .btn", ".check-row", ".site-nav a", ".brand"]) {
      expect(rule(selector), selector).toContain("min-height: 44px");
    }
    expect(rule("details summary")).toContain("padding: 10px 0");
  });

  it("styles the photo picker as a 44 px secondary button (qa-4)", () => {
    const picker = rule('input[type="file"]::file-selector-button');
    expect(picker).toContain("min-height: 44px");
    expect(picker).toContain("border-radius: 8px");
    expect(picker).toContain("font: inherit");
  });

  it("makes the overlay's Close and the launcher 44 px tall (qa-3)", () => {
    const code = readFileSync("public/embed.js", "utf8");
    expect(code).toMatch(/"button\{all:initial;[^"]*" \+\s*"min-height:44px;/);
    expect(code).toMatch(/"\.close\{all:initial;[^"]*" \+\s*"min-height:44px;padding:10px 16px;/);
  });
});

describe("timeline lane names (qa-2)", () => {
  it("wraps names instead of cutting them, and stacks each name over its track on phones", () => {
    expect(rule(".lane-label span")).toContain("white-space: normal");
    expect(rule(".lane-label span")).not.toContain("ellipsis");
    expect(rule(".lane-row")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".axis")).toContain("padding-left: 0");
    expect(css).toMatch(/@media \(min-width: 40rem\)[\s\S]*\.lane-row \{\s*grid-template-columns: 9rem minmax\(0, 1fr\)/);
  });
});

describe("embed snippet (qa-13)", () => {
  it("wraps on phones", () => {
    const demo = readFileSync("src/app/embed-demo/demo.module.css", "utf8");
    expect(demo).toMatch(/\.snippet \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere/);
  });
});

describe("one primary button after the daily cap (qa-11)", () => {
  const cap = friendlyError(429, "", { reason: "daily_cap" });

  it("turns the submit button secondary next to 'Continue in your AI assistant'", () => {
    expect(submitButtonClass(cap)).toBe("btn");
    expect(submitButtonClass(friendlyError(500, ""))).toBe("btn btn-primary");
    expect(submitButtonClass(null)).toBe("btn btn-primary");
  });

  it("applies on the photo confirm screen", () => {
    const recipe = { title: "Probe", nativeServings: 2, ingredients: [], steps: [] } as unknown as CanonicalRecipe;
    const html = renderToStaticMarkup(
      createElement(PhotoConfirm, {
        photoUrl: "blob:probe",
        fileName: "p.png",
        recipe,
        transcription: { text: "Probe", book: null, author: null, page: null } as never,
        busy: false,
        error: cap,
        onConfirm: () => {},
        onRetake: () => {},
      }),
    );
    expect(html).toContain('class="btn btn-primary" href="/assistants"');
    expect(html).toMatch(/<button type="button" class="btn">Looks right/);
  });
});

describe("footer takedown address (qa-12)", () => {
  it("shows the address as text, not only in a hover title", () => {
    const html = renderToString(createElement(RootLayout, null, ""));
    expect(html).toMatch(/Recipe takedown requests:(<!-- -->)?\s*<a href="mailto:privacy@textsous.com">privacy@textsous.com<\/a>/);
  });
});
