import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtifactViewer, { glassesFallbackHref, glassesHref } from "../src/app/ArtifactViewer";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const noop = () => {};
const artifact = fixtureArtifact();

describe("Cook on Meta glasses link", () => {
  it("links the finished cook along to the glasses view", () => {
    const html = renderToStaticMarkup(createElement(ArtifactViewer, { artifact, onStartOver: noop }));
    expect(html).toContain(">Cook on Meta glasses</a>");
    const embedded = renderToStaticMarkup(
      createElement(ArtifactViewer, { artifact, onStartOver: noop, embedded: true, onClose: noop }),
    );
    expect(embedded).not.toContain("Cook on Meta glasses");
  });

  it("builds the glasses links", () => {
    expect(glassesHref("https://open.textsous.com/api/artifact/x?sig=y")).toBe(
      "/glasses?src=https%3A%2F%2Fopen.textsous.com%2Fapi%2Fartifact%2Fx%3Fsig%3Dy",
    );
    expect(glassesFallbackHref({ kind: "url", url: "https://example.com/soup" })).toBe(
      "/glasses?url=https%3A%2F%2Fexample.com%2Fsoup",
    );
    expect(glassesFallbackHref({ kind: "photo", url: null })).toBe("/glasses");
  });
});
