import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import ArtifactViewer from "../src/app/ArtifactViewer";
import { convertNotices } from "../src/app/ConverterForm";
import { adjustRemaining } from "../src/app/Timer";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-viewer-probe",
    recipe: {
      title: "Probe Soup",
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
      credit: {
        kind: "text",
        site: null,
        author: null,
        url: null,
        book: null,
        page: null,
        license: null,
      },
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
        {
          id: "t-2",
          phase: "cook",
          label: "Rest",
          cardTitle: { action: "Rest", subject: "soup", context: "" },
          description: "Rest.",
          completionCue: "Settled.",
          minutes: 5,
          range: null,
          timingBasis: "estimate",
          sourceQuote: null,
          attention: "unattended",
          timerEnabledByDefault: false,
          laneIds: ["lane-1"],
          dependencies: ["t-1"],
          sourceStepIds: ["step-1"],
          checkpoints: [],
          tip: null,
          equipmentEvent: null,
          scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
        },
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "t-2",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [{ kind: "estimate", detail: "Simmer timing estimated." }],
  };
}

function renderViewer(): string {
  return renderToString(
    createElement(ArtifactViewer, { artifact: makeArtifact(), onStartOver: () => {} }),
  );
}

describe("artifact viewer layout", () => {
  it("puts the adjust panel near the top, above the timeline", () => {
    const html = renderViewer();
    expect(html.indexOf("Adjust this recipe")).toBeGreaterThan(-1);
    expect(html.indexOf("Adjust this recipe")).toBeLessThan(html.indexOf(">Timeline<"));
  });

  it("collapses the What changed list behind a disclosure", () => {
    const html = renderViewer();
    expect(html).toContain("<summary>What changed</summary>");
  });

  it("prompts for a cuisine with a short example that fits a phone", () => {
    const html = renderViewer();
    // The summary prints "<value> style", and a question was cut off at 390 px.
    expect(html).toContain('placeholder="e.g. Italian"');
    expect(html).toContain('maxLength="80"');
  });

  it("shows every step timer in one style, with minute adjusters", () => {
    const html = renderViewer();
    expect(html.match(/class="timer"/g)?.length).toBe(2);
    expect(html).not.toContain("<summary>Timer");
    expect(html).toContain("One minute less");
    expect(html).toContain("One minute more");
  });

  it("shows the convert warnings above Before you start, and nothing when there are none", () => {
    const note = "The page text was 90,000 characters; only the first 60,000 were kept.";
    const html = renderToString(
      createElement(ArtifactViewer, { artifact: makeArtifact(), onStartOver: () => {}, notices: [note] }),
    );
    expect(html).toContain("Notes on this conversion");
    expect(html.indexOf("only the first 60,000 were kept")).toBeGreaterThan(-1);
    expect(html.indexOf("only the first 60,000 were kept")).toBeLessThan(
      html.indexOf('aria-label="Before you start"'),
    );
    expect(renderViewer()).not.toContain("Notes on this conversion");
    expect(convertNotices([note, 3, "", null])).toEqual([note]);
    expect(convertNotices(undefined)).toEqual([]);
  });

  it("shows the artifact's advisory review notes once, even when the convert warnings repeat them", () => {
    const review =
      "The automatic review flagged the order of the steps: the toast waits for the beans. Compare with the original recipe if something looks off.";
    const artifact: CookAlongArtifact = {
      ...makeArtifact(),
      reviewNotes: [{ check: "source_relationships", status: "failed", detail: review }],
    };
    // A saved link or cache hit: no convert warnings, the note still shows.
    const saved = renderToString(createElement(ArtifactViewer, { artifact, onStartOver: () => {} }));
    expect(saved).toContain("Notes on this conversion");
    expect(saved).toContain("the toast waits for the beans");
    // A fresh conversion: the same sentence also came back as a warning.
    const fresh = renderToString(
      createElement(ArtifactViewer, { artifact, onStartOver: () => {}, notices: [review] }),
    );
    expect(fresh.split("the toast waits for the beans").length - 1).toBe(1);
  });

  it("keeps the estimated-time wording on estimates", () => {
    const html = renderViewer();
    expect(html).toContain("estimated time");
  });
});

describe("adjustRemaining", () => {
  it("shifts the countdown and clamps at zero", () => {
    expect(adjustRemaining(120, 60)).toBe(180);
    expect(adjustRemaining(120, -60)).toBe(60);
    expect(adjustRemaining(30, -60)).toBe(0);
  });
});
