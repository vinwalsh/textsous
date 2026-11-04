import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-action-row",
    recipe: {
      title: "Row Soup",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "stock",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          cookQuantity: null,
          buyQuantity: null,
          allergens: [],
          allergenTraces: [],
          note: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Simmer." }],
      allergens: [],
      originalMethod: "",
      methodLabel: "",
      methodNotice: "",
      credit: { kind: "text", site: null, author: null, url: null, book: null, page: null, license: null },
    },
    timelineDefinition: {
      lanes: [{ id: "lane-1", label: "Pot", color: "#000000", kind: "component" }],
      tasks: [
        {
          id: "t-1",
          phase: "cook",
          label: "Simmer",
          cardTitle: { action: "Simmer", subject: "soup", context: "" },
          description: "Simmer.",
          completionCue: "Hot.",
          minutes: 10,
          range: null,
          timingBasis: "estimate",
          sourceQuote: null,
          attention: "unattended",
          timerEnabledByDefault: true,
          laneIds: ["lane-1"],
          dependencies: [],
          sourceStepIds: ["step-1"],
          checkpoints: [],
          tip: null,
          equipmentEvent: null,
          scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
        },
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "t-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function render(props: { saveEnabled?: boolean; embedded?: boolean; onClose?: () => void } = {}): string {
  return renderToStaticMarkup(
    createElement(ArtifactViewer, { artifact: makeArtifact(), onStartOver: () => {}, ...props }),
  );
}

/** The action row's markup and the buttons in it, in order. */
function actionRow(html: string): { row: string; buttons: string[] } {
  const start = html.indexOf('<div class="btn-row save-row">');
  expect(start, "action row").toBeGreaterThan(-1);
  const row = html.slice(start, html.indexOf("</div>", start) + "</div>".length);
  const buttons = [...row.matchAll(/<button [^>]*class="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(
    (m) => `${m[1]}: ${m[2]}`,
  );
  return { row, buttons };
}

describe("cook along action row", () => {
  it("puts Save to TextSous and Convert another recipe side by side in one row", () => {
    const { row, buttons } = actionRow(render({ saveEnabled: true }));
    expect(buttons).toEqual(["btn btn-primary: Save to TextSous", "btn: Convert another recipe"]);
    // Nothing else sits in the row: the two buttons are its only children.
    expect(row).toMatch(/^<div class="btn-row save-row"><button [^>]*>[^<]*<\/button><button [^>]*>[^<]*<\/button><\/div>$/);
  });

  it("leaves Convert another recipe alone in the row when saving is turned off", () => {
    expect(actionRow(render({ saveEnabled: false })).buttons).toEqual(["btn: Convert another recipe"]);
  });

  it("pairs Save with Close inside the /embed overlay", () => {
    const html = render({ saveEnabled: true, embedded: true, onClose: () => {} });
    expect(actionRow(html).buttons).toEqual(["btn btn-primary: Save to TextSous", "btn: Close"]);
    expect(html).not.toContain("Convert another recipe");
  });

  it("keeps two equal, equally tall buttons on one line down to a 320 px phone", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = (selector: string): string => {
      const at = css.indexOf(`\n${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    const row = rule(".save-row");
    expect(row).toContain("display: flex");
    expect(row).toContain("flex-wrap: wrap");
    expect(row).toContain("align-items: stretch");
    const button = rule(".save-row > .btn");
    expect(button).toContain("flex: 1 1 8.5rem");
    expect(rule(".save-row > .btn:only-child")).toContain("flex: 0 1 auto");
    expect(rule(".btn")).toContain("min-height: 44px");
    // Two 8.5rem buttons and the gap fit the 288 px a 320 px phone leaves
    // inside main's 16 px gutters, so the row wraps only below that.
    const basis = Number(/flex: 1 1 ([\d.]+)rem/.exec(button)?.[1]) * 16;
    const gap = Number(/gap: (\d+)px/.exec(row)?.[1]);
    expect(2 * basis + gap).toBeLessThanOrEqual(320 - 2 * 16);
    expect(rule("body > main")).toContain("padding: 8px 16px 56px");
  });
});
