import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer from "../src/app/ArtifactViewer";
import EmbedApp, { EmbedStatus, initialEmbedState, readyFromConvert } from "../src/app/embed/EmbedApp";
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
