import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import EmbedApp, {
  EmbedStatus,
  embedStage,
  initialEmbedState,
  readyFromConvert,
  requestedChoices,
  workingLine,
} from "../src/app/embed/EmbedApp";
import { saveToTextSousEnabled } from "../src/lib/handoff";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const noop = () => {};

describe("/embed page first render", () => {
  it("starts loading for ?url= without any site chrome", () => {
    const html = renderToString(
      createElement(EmbedApp, { request: { kind: "url", url: "https://example.com/soup" } }),
    );
    expect(html).toContain("Getting your Cook Along ready");
    expect(html).toContain("ts-embed-root");
    expect(html).not.toContain("TextSous Open</h1>");
    expect(html).not.toContain('role="tablist"');
  });

  it("starts loading for ?src=", () => {
    const html = renderToString(
      createElement(EmbedApp, { request: { kind: "src", src: "https://open.textsous.com/api/artifact/x?sig=y" } }),
    );
    expect(html).toContain("Getting your Cook Along ready");
  });

  it("explains a missing recipe", () => {
    const html = renderToString(createElement(EmbedApp, { request: { kind: "none" } }));
    expect(html).toContain("No recipe to show");
    expect(html).toContain("data-recipe-url");
  });

  it("keeps the privacy line", () => {
    const html = renderToString(createElement(EmbedApp, { request: { kind: "none" } }));
    expect(html).toContain("private to you");
  });

  it("derives the first state from the request only", () => {
    expect(initialEmbedState({ kind: "none" })).toEqual({ kind: "none" });
    expect(initialEmbedState({ kind: "url", url: "https://x.test/r" }).kind).toBe("starting");
  });
});

describe("/embed page states", () => {
  it("names both hosts on a same-page mismatch and offers the open site in a new tab", () => {
    const html = renderToString(
      createElement(EmbedStatus, {
        state: { kind: "mismatch", recipeHost: "other.test", pageHost: "example.com", url: "https://other.test/r" },
        onClose: noop,
      }),
    );
    expect(html).toContain("only converts recipes from this site");
    expect(html).toContain("other.test");
    expect(html).toContain("example.com");
    expect(html).toContain('href="/?url=https%3A%2F%2Fother.test%2Fr"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain(">Close</button>");
  });

  it("shows conversion progress with the recipe's host", () => {
    const html = renderToString(
      createElement(EmbedStatus, { state: { kind: "converting", url: "https://www.example.com/soup" } }),
    );
    expect(html).toContain("Turning this recipe into a Cook Along");
    expect(html).toContain("from example.com");
    expect(html).toContain("You stay on this page");
  });

  it("shows friendly errors with a way out", () => {
    const html = renderToString(
      createElement(EmbedStatus, {
        state: {
          kind: "error",
          error: { title: "Couldn't reach that page", detail: "The recipe site didn't answer." },
          url: "https://example.com/soup",
        },
        onClose: noop,
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t reach that page");
    expect(html).toContain("Try on TextSous Open");
    expect(html).toContain(">Close</button>");
  });

  it("hides Close when the page is not framed", () => {
    const html = renderToString(
      createElement(EmbedStatus, {
        state: { kind: "mismatch", recipeHost: "a.test", pageHost: "b.test", url: "https://a.test/r" },
      }),
    );
    expect(html).not.toContain(">Close</button>");
  });
});

describe("embedded artifact viewer", () => {
  const artifact = fixtureArtifact();

  it("swaps 'Convert another recipe' for Close inside the overlay", () => {
    const html = renderToString(
      createElement(ArtifactViewer, { artifact, onStartOver: noop, embedded: true, onClose: noop }),
    );
    expect(html).toContain("Toasted Oat Porridge with Brown Butter Apples");
    expect(html).toContain("Save to TextSous");
    expect(html).toContain(">Close</button>");
    expect(html).not.toContain("Convert another recipe");
  });

  it("is unchanged on the home page", () => {
    const html = renderToString(createElement(ArtifactViewer, { artifact, onStartOver: noop }));
    expect(html).toContain("Convert another recipe");
    expect(html).not.toContain(">Close</button>");
  });

  it("hides Save to TextSous when the deploy turns it off (textsous.com/import not live yet)", () => {
    expect(saveToTextSousEnabled(undefined)).toBe(true);
    expect(saveToTextSousEnabled("")).toBe(true);
    expect(saveToTextSousEnabled("on")).toBe(true);
    for (const off of ["off", "OFF", "0", "false", " no "]) expect(saveToTextSousEnabled(off)).toBe(false);
    const hidden = renderToString(
      createElement(ArtifactViewer, { artifact, onStartOver: noop, saveEnabled: false }),
    );
    expect(hidden).not.toContain("Save to TextSous");
    expect(hidden).not.toContain("Saving keeps the recipe");
    expect(hidden).toContain("Convert another recipe");
    const shown = renderToString(createElement(ArtifactViewer, { artifact, onStartOver: noop }));
    expect(shown).toContain("Save to TextSous");
  });

  it("keeps the convert warnings and shows them in the overlay, as on the home page", () => {
    const cut = "The page text was 90,000 characters; only the first 60,000 were read.";
    const ready = readyFromConvert({ artifact, cached: false, warnings: [cut, 3, ""] });
    expect(ready).toEqual({ kind: "ready", artifact, notices: [cut] });
    expect(readyFromConvert({ artifact, cached: true })?.notices).toEqual([]);
    expect(readyFromConvert({ artifact: { id: "nope" } })).toBeNull();
    const html = renderToString(
      createElement(ArtifactViewer, {
        artifact,
        notices: ready?.notices,
        onStartOver: noop,
        embedded: true,
        onClose: noop,
      }),
    );
    expect(html).toContain("Notes on this conversion");
    expect(html).toContain("only the first 60,000 were read");
  });
});

describe("/embed with an adjustment from the Adjust with SOUS menu", () => {
  const artifact = fixtureArtifact();
  const base = artifact.recipe.servings;
  const url = "https://example.com/soup";

  it("shows the calm line from the first render", () => {
    const html = renderToString(
      createElement(EmbedApp, { request: { kind: "url", url, adjust: { servings: 18 } } }),
    );
    expect(html).toContain("Scaling to 18 servings\u2026");
    expect(html).toContain('role="status"');
    expect(html).toContain("Getting your Cook Along ready");
    const plain = renderToString(createElement(EmbedApp, { request: { kind: "url", url } }));
    expect(plain).not.toContain("Scaling to");
  });

  it("turns the address's adjustment into the panel's queued choices once the servings are known", () => {
    expect(requestedChoices({ servings: 18 }, null)).toBeNull();
    expect(requestedChoices(null, 4)).toBeNull();
    expect(requestedChoices({ servings: 18 }, 12)).toEqual({ servings: 18, dietary: "", cuisine: "", sousVoice: false });
    // The menu's stepper starts at the recipe's own servings: tapping "Show it" unchanged queues nothing.
    expect(requestedChoices({ servings: 12 }, 12)).toBeNull();
    expect(requestedChoices({ dietary: "vegan" }, 12)).toEqual({ servings: 12, dietary: "vegan", cuisine: "", sousVoice: false });
    expect(requestedChoices({ cuisine: "Italian" }, 4)?.cuisine).toBe("Italian");
  });

  it("applies the adjustment as soon as the cook along opens, cached or fresh (one /api/adjust call)", () => {
    const html = renderToString(
      createElement(ArtifactViewer, {
        artifact,
        onStartOver: noop,
        embedded: true,
        onClose: noop,
        queuedAdjustments: requestedChoices({ dietary: "vegan" }, base),
      }),
    );
    expect(html).toContain("Adjusting\u2026");
    expect(html).toMatch(/<option value="vegan" selected="">/);
    // Nothing to change: the panel waits for the cook as before.
    const same = renderToString(
      createElement(ArtifactViewer, {
        artifact,
        onStartOver: noop,
        queuedAdjustments: requestedChoices({ servings: base }, base),
      }),
    );
    expect(same).not.toContain("Adjusting\u2026");
  });

  it("keeps the line only while the adjustment is on its way", () => {
    const adjust = { servings: 18 };
    const line = (over: Partial<Parameters<typeof workingLine>[0]>) =>
      workingLine({ adjust, stage: "working", base: null, ownQueue: false, settled: false, ...over });
    expect(line({})).toBe("Scaling to 18 servings\u2026");
    expect(line({ base: 12 })).toBe("Scaling to 18 servings\u2026");
    expect(line({ stage: "ready", base: 12 })).toBe("Scaling to 18 servings\u2026");
    expect(line({ stage: "ready", base: 12, settled: true })).toBeNull();
    expect(line({ stage: "ready", base: 18 })).toBeNull();
    expect(line({ stage: "stopped" })).toBeNull();
    expect(line({ ownQueue: true })).toBeNull();
    expect(line({ adjust: null })).toBeNull();
    expect(line({ adjust: { servings: 4, dietary: "vegan" }, stage: "ready", base: 4 })).toBe("Making it vegan\u2026");
  });

  it("names the overlay's stage", () => {
    expect(embedStage({ kind: "converting", url })).toBe("working");
    expect(embedStage({ kind: "loading" })).toBe("working");
    expect(embedStage({ kind: "ready", artifact, notices: [] })).toBe("ready");
    expect(embedStage({ kind: "mismatch", recipeHost: "a", pageHost: "b", url })).toBe("stopped");
    expect(embedStage({ kind: "none" })).toBe("stopped");
  });
});
