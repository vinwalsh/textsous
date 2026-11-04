import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdjustPanel from "../src/app/AdjustPanel";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import { MAX_SERVINGS, MIN_SERVINGS, servingsInRange } from "../src/lib/scaling/servings";
import * as stage from "../src/lib/stages/scaling";

function artifactServing(servings: number): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-servings",
    recipe: {
      title: "Muffins",
      servings,
      nativeServings: 12,
      ingredients: [
        {
          id: "flour",
          name: "flour",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          allergens: ["gluten"],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Bake." }],
      allergens: ["gluten"],
      originalMethod: "",
      methodLabel: "",
      methodNotice: "",
      credit: { kind: "text", site: null, author: null, url: null, book: null, page: null, license: null },
    },
    timelineDefinition: { lanes: [], tasks: [], resources: [], resourceHolds: [], serveTaskId: "t" },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function panel(servings: number): string {
  return renderToStaticMarkup(
    createElement(AdjustPanel, {
      artifact: artifactServing(servings),
      modified: false,
      onAdjusted: () => {},
      onReset: () => {},
    }),
  );
}

/** The <button> whose aria-label is `label`, as markup. */
function button(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html);
  expect(match, label).not.toBeNull();
  return match![0];
}

describe("servings range", () => {
  it("runs from 0.5 to 36, and the scaling stage uses the same bounds", () => {
    expect(MIN_SERVINGS).toBe(0.5);
    expect(MAX_SERVINGS).toBe(36);
    expect(stage.MIN_SERVINGS).toBe(MIN_SERVINGS);
    expect(stage.MAX_SERVINGS).toBe(MAX_SERVINGS);
    for (const ok of [0.5, 1, 12, 18, 36]) expect(servingsInRange(ok), String(ok)).toBe(true);
    for (const bad of [0, 0.49, 36.01, 37, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(servingsInRange(bad), String(bad)).toBe(false);
    }
  });

  it("lets the adjust panel go up to 36 servings", () => {
    const html = panel(12);
    const input = /<input type="number"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('max="36"');
    expect(input).toContain('value="12"');
    expect(button(html, "One more serving")).not.toContain("disabled");
    expect(button(html, "One fewer serving")).not.toContain("disabled");
  });

  it("stops the + button at 36 and the - button at 1", () => {
    expect(button(panel(36), "One more serving")).toContain("disabled");
    expect(button(panel(35), "One more serving")).not.toContain("disabled");
    expect(button(panel(1), "One fewer serving")).toContain("disabled");
  });
});
