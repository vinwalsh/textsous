import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProgressNote, { progressCopy } from "../src/app/ProgressNote";

describe("progress copy", () => {
  it("describes the convert stages in plain words", () => {
    const copy = progressCopy("convert");
    expect(copy).toContain("Usually 3 to 4 minutes");
    expect(copy).toContain("reading the recipe");
    expect(copy).toContain("planning the timeline");
    expect(copy).toContain("checking it");
  });

  it("describes transcribing and adjusting honestly", () => {
    expect(progressCopy("transcribe")).toContain("reading the photo");
    // Transcribe plus canonicalize runs 1-2 minutes, not "under a minute".
    expect(progressCopy("transcribe")).toContain("Usually 1 to 2 minutes");
    expect(progressCopy("adjust")).toContain("applying your changes");
  });

  it("shows elapsed time with no fake percentages", () => {
    const html = renderToString(createElement(ProgressNote, { kind: "convert" }));
    expect(html).toContain("Elapsed");
    expect(html).toContain("0:00");
    expect(html).toContain("reading the recipe");
    expect(html).not.toContain("%");
  });
});
