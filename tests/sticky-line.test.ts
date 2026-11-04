import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdjustChoices } from "../src/app/AdjustPanel";
import ArtifactViewer from "../src/app/ArtifactViewer";
import CookingLine, { FinishLine, READY_MS } from "../src/app/CookingLine";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const css = readFileSync("src/app/globals.css", "utf8");

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
}

describe("the cooking line sticks to the top", () => {
  it("is sticky at the top on a solid card background with a soft shadow", () => {
    const line = rule(".cooking-line");
    expect(line).toContain("position: sticky;");
    expect(line).toContain("top: 0;");
    expect(line).toContain("background: var(--ts-card);");
    expect(line).toMatch(/box-shadow: [^;]+;/);
    expect(line).toMatch(/z-index: \d+;/);
  });

  it("keeps focus and jumps below it, and shrinks its icons on a narrow phone", () => {
    expect(css).toMatch(/html:has\(\.cooking-line\) \{\s*scroll-padding-top: \d+px;/);
    const narrow = css.slice(css.indexOf("@media (max-width: 400px)"));
    expect(narrow).toMatch(/^@media \(max-width: 400px\) \{\s*\.cooking-line-icons \{\s*font-size: 19px;/);
  });

  it("goes without fading under prefers-reduced-motion", () => {
    expect(rule(".cooking-line-ready")).toContain("animation: ts-line-out");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.cooking-line-ready \{\s*animation: none;/);
  });

  it("can leave the announcing to its parent", () => {
    const quiet = renderToStaticMarkup(createElement(CookingLine, { status: "Adjusting", live: false }));
    expect(quiet).toContain("<span>Adjusting…</span>");
    expect(quiet).not.toContain('role="status"');
  });
});

describe("the finished page's top line", () => {
  it("says Ready for a moment when the cook along was just written here", () => {
    const html = renderToStaticMarkup(createElement(FinishLine, { adjusting: false, built: true }));
    expect(html).toContain('<div class="cooking-line cooking-line-ready">');
    expect(html).toContain("Your Cook Along is ready");
    expect(html).toContain('<p class="visually-hidden" role="status" aria-live="polite">');
    expect(READY_MS).toBeGreaterThanOrEqual(2000);
    expect(READY_MS).toBeLessThanOrEqual(4000);
  });

  it("shows the cooking line with Adjusting… while an adjustment applies", () => {
    const html = renderToStaticMarkup(createElement(FinishLine, { adjusting: true, built: true }));
    expect(html).toContain('class="cooking-line"');
    expect(html).toContain("Adjusting…");
    expect(html).not.toContain("Your Cook Along is ready");
  });

  it("shows nothing for a saved cook along that is not adjusting", () => {
    const html = renderToStaticMarkup(createElement(FinishLine, { adjusting: false }));
    expect(html).not.toContain("cooking-line");
  });

  const artifact = fixtureArtifact();
  const queued: AdjustChoices = { servings: artifact.recipe.servings + 2, dietary: "", cuisine: "", sousVoice: false };

  it("tops the finished page: Ready after a conversion, Adjusting… while queued changes apply", () => {
    const fresh = renderToStaticMarkup(createElement(ArtifactViewer, { artifact, onStartOver: () => {}, built: true }));
    expect(fresh.indexOf("cooking-line-ready")).toBeLessThan(fresh.indexOf('class="recipe-head"'));
    const adjusting = renderToStaticMarkup(
      createElement(ArtifactViewer, { artifact, onStartOver: () => {}, built: true, queuedAdjustments: queued }),
    );
    expect(adjusting).toMatch(/<div class="cooking-line">[\s\S]*<span>Adjusting…<\/span>/);
    const saved = renderToStaticMarkup(createElement(ArtifactViewer, { artifact, onStartOver: () => {} }));
    expect(saved).not.toContain("cooking-line");
  });
});
