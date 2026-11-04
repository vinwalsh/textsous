import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { TimelineTask } from "../src/lib/schema/timeline";
import ArtifactViewer, { handsOnMinutes, readTipsMode, TIPS_MODE_KEY } from "../src/app/ArtifactViewer";

function task(id: string, over: Partial<TimelineTask>): TimelineTask {
  return {
    id,
    phase: "cook",
    label: id,
    cardTitle: { action: "Cook", subject: id, context: "" },
    description: `${id} description.`,
    completionCue: `${id} cue.`,
    minutes: 5,
    range: null,
    timingBasis: "estimate",
    sourceQuote: null,
    attention: "hands-on",
    timerEnabledByDefault: false,
    laneIds: ["lane-sauce"],
    dependencies: [],
    sourceStepIds: ["step-1"],
    checkpoints: [],
    tip: null,
    why: null,
    equipmentEvent: null,
    scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
    ...over,
  };
}

function artifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-format-probe",
    recipe: {
      title: "Probe Stew",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "onion",
          quantity: "1",
          unit: "",
          quantity4: null,
          scaleRule: null,
          cookQuantity: null,
          buyQuantity: null,
          allergens: [],
          allergenTraces: [],
          note: "diced",
        },
      ],
      equipment: ["large pot", "wooden spoon"],
      steps: [{ id: "step-1", kind: "active", text: "Cook." }],
      allergens: [],
      originalMethod: "",
      methodLabel: "",
      methodNotice: "",
      credit: { kind: "text", site: null, author: null, url: null, book: null, page: null, license: null },
    },
    timelineDefinition: {
      lanes: [
        { id: "lane-sauce", label: "Stew", color: "#B94C39", kind: "component" },
        { id: "lane-base", label: "Rice", color: "#B58D3D", kind: "component" },
        { id: "lane-kitchen", label: "Kitchen", color: "#AAA398", kind: "kitchen" },
      ],
      tasks: [
        task("t-dice", {
          phase: "prep",
          minutes: 3,
          description: "Dice 1 onion.",
          tip: "Prep tip text.",
          why: "Prep why text.",
        }),
        task("t-brown", { minutes: 4, why: "Browning builds flavor.", tip: "Keep the pan hot." }),
        task("t-simmer", {
          minutes: 20,
          attention: "unattended",
          dependencies: ["t-brown"],
          checkpoints: ["Bubbles gently"],
        }),
        task("t-serve", { phase: "finish", minutes: 2, dependencies: ["t-simmer"] }),
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "t-serve",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function render(): string {
  return renderToString(
    createElement(ArtifactViewer, { artifact: artifact(), onStartOver: () => {} }),
  ).replace(/<!-- -->/g, "");
}

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});

describe("Before you start", () => {
  it("shows time to serve, hands-on minutes, one cook, components and equipment", () => {
    const html = render();
    expect(html).toContain('aria-label="Before you start"');
    // 3 prep + 4 brown + 20 simmer + 2 serve = 29; hands-on 3 + 4 + 2 = 9.
    expect(html).toContain("About 29 min to serve · 9 min hands-on · One cook");
    expect(html).toContain("What you are cooking");
    // Lanes take the earth-tone palette by position, not the color the artifact stored.
    expect(html).toMatch(/background-color:#B58D3D[^>]*><\/span>Stew/);
    expect(html).toMatch(/background-color:#587454[^>]*><\/span>Rice/);
    expect(html).not.toContain("#B94C39");
    expect(html).not.toMatch(/component-list[^]*Kitchen[^]*<\/ul>[^]*Equipment/);
    expect(html).toContain("<li>large pot</li>");
    expect(html).toContain("<li>wooden spoon</li>");
    expect(html.indexOf("Before you start")).toBeLessThan(html.indexOf(">Ingredients<"));
  });

  it("counts hands-on minutes only", () => {
    expect(handsOnMinutes(artifact().timelineDefinition.tasks)).toBe(9);
  });
});

describe("Essentials / With tips", () => {
  it("defaults to With tips and shows tip and why", () => {
    const html = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*>With tips/);
    expect(html).toContain("Why: Browning builds flavor.");
    expect(html).toContain("Tip: Keep the pan hot.");
    expect(html).toContain("Prep why text.");
  });

  it("Essentials hides tips and why but keeps descriptions, cues and checkpoints", () => {
    g.window = { localStorage: { getItem: (key: string) => (key === TIPS_MODE_KEY ? "essentials" : null) } };
    const html = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*>Essentials/);
    expect(html).not.toContain("Browning builds flavor.");
    expect(html).not.toContain("Keep the pan hot.");
    expect(html).not.toContain("Prep tip text.");
    expect(html).toContain("t-brown description.");
    expect(html).toContain("Dice 1 onion.");
    expect(html).toContain("t-simmer cue.");
    expect(html).toContain("Bubbles gently");
  });

  it("falls back to With tips when storage throws or holds junk", () => {
    g.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(readTipsMode()).toBe("tips");
    g.window = { localStorage: { getItem: () => "loud" } };
    expect(readTipsMode()).toBe("tips");
    delete g.window;
    expect(readTipsMode()).toBe("tips");
  });
});
