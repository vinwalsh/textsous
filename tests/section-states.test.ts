import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdjustChoices } from "../src/app/AdjustPanel";
import { initialConversionState, reduceConversion, type ConversionAction, type ConversionState } from "../src/app/conversion";
import ProgressiveView from "../src/app/ProgressiveView";
import {
  adjustedSections,
  BEFORE_CHANGES,
  isBusy,
  SECTION_KEYS,
  SECTION_TITLES,
  sectionStates,
  type SectionKey,
  type SectionPhase,
} from "../src/app/section-states";
import { EmbedStatus } from "../src/app/embed/EmbedApp";
import type { RecipeFacts } from "../src/lib/convert-events";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition } from "../src/lib/schema/timeline";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const recording = JSON.parse(
  readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
) as { recipe: CanonicalRecipe; response: string };
const RECIPE = recording.recipe;
const TIMELINE = JSON.parse(recording.response) as TimelineDefinition;
const URL = "https://example.com/recipes/porridge";
const FACTS: RecipeFacts = {
  title: "Toasted Oat Porridge",
  source: { kind: "url", url: URL, site: "example.com", author: null },
  servingsText: "2",
  ingredientCount: 6,
  minutes: { prep: null, cook: null, total: null },
  allergens: [],
  traces: [],
};

function stateAfter(...actions: ConversionAction[]): ConversionState {
  return [{ type: "start", body: { url: URL } } as ConversionAction, ...actions].reduce(
    reduceConversion,
    initialConversionState,
  );
}

const started = stateAfter();
const withFacts = stateAfter({ type: "facts", facts: FACTS });
const withOverview = reduceConversion(withFacts, {
  type: "overview",
  overview: { summary: "Toast, simmer, top.", components: [] },
});
const withRecipe = reduceConversion(withOverview, { type: "recipe", recipe: RECIPE, facts: FACTS });
const withProcedure = reduceConversion(withRecipe, { type: "procedure", timeline: TIMELINE });
const done = reduceConversion(withProcedure, { type: "done", artifact: fixtureArtifact(), cached: false, warnings: [] });

function phases(state: ConversionState): Record<SectionKey, SectionPhase> {
  const all = sectionStates(state);
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, all[key].phase])) as Record<SectionKey, SectionPhase>;
}

describe("section states", () => {
  it("lists every section of the finished page, in its order", () => {
    expect(SECTION_KEYS).toEqual(["facts", "overview", "adjust", "ingredients", "before", "prep", "steps", "timeline"]);
    expect(SECTION_TITLES.prep).toBe("Prep (Mise en Place style)");
    expect(SECTION_TITLES.timeline).toBe("Timeline");
  });

  it("before the facts: only the facts are being written", () => {
    expect(phases(started)).toEqual({
      facts: "working",
      overview: "coming",
      adjust: "coming",
      ingredients: "coming",
      before: "coming",
      prep: "coming",
      steps: "coming",
      timeline: "coming",
    });
    expect(sectionStates(started).facts.note).toBe("Finding the title, servings and allergens…");
  });

  it("with the facts: the summary, the ingredients and Before you start are being written", () => {
    expect(phases(withFacts)).toMatchObject({
      facts: "ready",
      overview: "working",
      adjust: "coming",
      ingredients: "working",
      before: "working",
      prep: "coming",
      steps: "coming",
      timeline: "coming",
    });
    expect(sectionStates(withFacts).ingredients.note).toBe("Reading the ingredients…");
    expect(sectionStates(withFacts).facts.note).toBeNull();
  });

  it("with the summary: the summary is ready, the rest as before", () => {
    expect(phases(withOverview)).toMatchObject({ overview: "ready", ingredients: "working", adjust: "coming" });
  });

  it("with the recipe: ingredients and adjustments ready, prep and steps being laid out", () => {
    expect(phases(withRecipe)).toEqual({
      facts: "ready",
      overview: "ready",
      adjust: "ready",
      ingredients: "ready",
      before: "working",
      prep: "working",
      steps: "working",
      timeline: "coming",
    });
    expect(sectionStates(withRecipe).before.note).toBe("Working out the time to serve…");
    expect(sectionStates(withRecipe).steps.note).toBe("Laying out the steps…");
  });

  it("with the procedure: prep and steps checked against the original, the timeline being built", () => {
    expect(phases(withProcedure)).toMatchObject({
      before: "ready",
      prep: "checking",
      steps: "checking",
      timeline: "working",
    });
    expect(sectionStates(withProcedure).prep.note).toBe("Checking against the original…");
    expect(sectionStates(withProcedure).timeline.note).toBe("Fitting every step on one timeline…");
  });

  it("keeps waiting for a summary that is late, and calls everything ready when done", () => {
    const late = reduceConversion(
      reduceConversion(stateAfter({ type: "facts", facts: FACTS }), { type: "recipe", recipe: RECIPE, facts: FACTS }),
      { type: "procedure", timeline: TIMELINE },
    );
    expect(phases(late).overview).toBe("working");
    expect(Object.values(phases(done))).toEqual(SECTION_KEYS.map(() => "ready"));
    expect(Object.values(sectionStates(done)).every((s) => s.note === null)).toBe(true);
  });

  it("knows a confirmed photo recipe at once: only the summary, prep, steps and timeline wait", () => {
    const photo = reduceConversion(initialConversionState, { type: "start", body: { recipe: RECIPE } });
    expect(phases(photo)).toEqual({
      facts: "ready",
      overview: "working",
      adjust: "ready",
      ingredients: "ready",
      before: "working",
      prep: "working",
      steps: "working",
      timeline: "coming",
    });
  });

  it("spins only while a section is being written or checked", () => {
    expect(isBusy("working")).toBe(true);
    expect(isBusy("checking")).toBe(true);
    expect(isBusy("coming")).toBe(false);
    expect(isBusy("ready")).toBe(false);
  });
});

describe("before your changes", () => {
  it("marks the facts, ingredients, prep, steps and timeline for servings, a diet or a style", () => {
    const all = ["facts", "ingredients", "prep", "steps", "timeline"];
    expect(adjustedSections({ servings: 18, dietary: "", cuisine: "", sousVoice: false }, 12)).toEqual(all);
    expect(adjustedSections({ servings: 12, dietary: "vegan", cuisine: "", sousVoice: false }, 12)).toEqual(all);
    expect(adjustedSections({ servings: 12, dietary: "", cuisine: " Italian ", sousVoice: false }, 12)).toEqual(all);
  });

  it("marks only the prep, steps and timeline for SOUS voice, and nothing without a change", () => {
    expect(adjustedSections({ servings: 4, dietary: "", cuisine: "", sousVoice: true }, 4)).toEqual([
      "prep",
      "steps",
      "timeline",
    ]);
    expect(adjustedSections({ servings: 4, dietary: "", cuisine: "  ", sousVoice: false }, 4)).toEqual([]);
    expect(adjustedSections(null, 4)).toEqual([]);
  });

  it("counts an address's servings as a change while the recipe's servings are unknown", () => {
    expect(adjustedSections({ servings: 18 }, null)).toContain("ingredients");
    expect(adjustedSections({ servings: 18 }, 18)).toEqual([]);
  });

  const queued: AdjustChoices = { servings: 4, dietary: "vegan", cuisine: "", sousVoice: false };

  function render(state: ConversionState, q: AdjustChoices | null, requested: { servings?: number } | null = null) {
    return renderToStaticMarkup(createElement(ProgressiveView, { state, queued: q, onQueue: () => {}, requested }));
  }

  it("badges the sections a queued adjustment will change, in the progressive view", () => {
    const html = render(withProcedure, queued);
    expect(html.match(new RegExp(`>${BEFORE_CHANGES}<`, "g"))).toHaveLength(5);
    // The servings line, then ingredients, prep, steps and the timeline placeholder.
    const at = (marker: string) => html.indexOf(marker);
    expect(at('<span class="pre-adjust-badge">Before your changes</span>')).toBeGreaterThan(at("Posted: serves 2"));
    expect(html).toMatch(/data-section="timeline"[\s\S]*Before your changes[\s\S]*<\/section><\/article>$/);
    // No queue: no badge.
    expect(render(withProcedure, null)).not.toContain(BEFORE_CHANGES);
  });

  it("badges the address's adjustment in /embed before the recipe's servings are known", () => {
    const early = render(withFacts, null, { servings: 18 });
    expect(early).toContain(BEFORE_CHANGES);
    const embed = renderToStaticMarkup(
      createElement(EmbedStatus, {
        state: { kind: "converting", url: URL },
        progress: { conversion: withFacts, queued: null, onQueue: () => {}, requested: { dietary: "vegan" } },
      }),
    );
    expect(embed.match(/>Before your changes</g)).toHaveLength(5);
  });

  it("explains the badge where the queued changes are listed", () => {
    const html = render(withRecipe, queued);
    expect(html).toContain("Until they apply, the parts they change are marked “Before your changes”.");
  });
});

describe("section state styles", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("has a section spinner and a different adjustment spinner, both still under reduced motion", () => {
    expect(css).toMatch(/\.ts-spinner \{[^}]*animation: ts-spin/);
    expect(css).toMatch(/\.ts-spinner-adjust \{[^}]*border-top-color: var\(--ts-warn-ink\)/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.ts-spinner,\s*\.section-ready \{\s*animation: none;/);
  });

  it("styles Coming up without a spinner, and the Before your changes badge in the notice colors", () => {
    expect(css).toMatch(/\.section-slot-coming \{[^}]*border-style: dashed/);
    expect(css).toMatch(/\.pre-adjust-badge \{[^}]*color: var\(--ts-warn-ink\)/);
    expect(css).toMatch(/\.section-ready \{[^}]*animation: ts-ready-fade/);
  });
});
