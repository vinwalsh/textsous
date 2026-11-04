import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjustRequestBody,
  adjustSummary,
  hasAdjustment,
  requestAdjustment,
  type AdjustChoices,
} from "../src/app/AdjustPanel";
import ArtifactViewer from "../src/app/ArtifactViewer";
import { initialConversionState, reduceConversion, type ConversionAction, type ConversionState } from "../src/app/conversion";
import ConverterForm from "../src/app/ConverterForm";
import CookingLine from "../src/app/CookingLine";
import { EmbedStatus } from "../src/app/embed/EmbedApp";
import ProgressiveView, { factsLine } from "../src/app/ProgressiveView";
import type { RecipeFacts, RecipeOverview } from "../src/lib/convert-events";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition } from "../src/lib/schema/timeline";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const recording = JSON.parse(
  readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
) as { recipe: CanonicalRecipe; response: string };
const RECIPE: CanonicalRecipe = { ...recording.recipe, equipment: ["saucepan", "skillet"] };
const TIMELINE = JSON.parse(recording.response) as TimelineDefinition;
const URL = "https://example.com/recipes/muffins";

const FACTS: RecipeFacts = {
  title: "Blueberry Muffins",
  source: { kind: "url", url: URL, site: "Example Kitchen", author: "Sam" },
  servingsText: "12 muffins",
  ingredientCount: 9,
  minutes: { prep: 15, cook: 25, total: 40 },
  allergens: ["gluten", "egg", "milk"],
  traces: ["nuts"],
};

const OVERVIEW: RecipeOverview = {
  summary: "Toast the oats, simmer them in milk, then top with brown butter apples.",
  components: [
    { name: "Porridge", how: "Toast the oats, then simmer in milk until thick." },
    { name: "Apples", how: "Slice and cook in brown butter." },
  ],
};

function stateAfter(...actions: ConversionAction[]): ConversionState {
  return [{ type: "start", body: { url: URL } } as ConversionAction, ...actions].reduce(
    reduceConversion,
    initialConversionState,
  );
}

function render(state: ConversionState, queued: AdjustChoices | null = null): string {
  return renderToString(createElement(ProgressiveView, { state, queued, onQueue: () => {} })).replace(
    /<!-- -->/g,
    "",
  );
}

const withFacts = stateAfter({ type: "facts", facts: FACTS });
const withOverview = stateAfter({ type: "facts", facts: FACTS }, { type: "overview", overview: OVERVIEW });
const withRecipe = stateAfter(
  { type: "facts", facts: FACTS },
  { type: "overview", overview: OVERVIEW },
  { type: "recipe", recipe: RECIPE, facts: { ...FACTS, servingsText: "2", ingredientCount: RECIPE.ingredients.length } },
);
const withProcedure = reduceConversion(withRecipe, { type: "procedure", timeline: TIMELINE });

describe("progressive view, part by part", () => {
  it("shows only the cooking line before anything arrives", () => {
    const html = render(stateAfter());
    expect(html).toContain('class="cooking-line"');
    expect(html).toMatch(/role="status" aria-live="polite">Reading the recipe…</);
    expect(html).not.toContain("About this recipe");
    expect(html).not.toContain("Adjust this recipe");
  });

  it("shows the facts card with the posted yield, counts, times, credit and allergens", () => {
    const html = render(withFacts);
    expect(html).toContain("Summarizing…");
    expect(html).toContain('<h2 class="recipe-title">Blueberry Muffins</h2>');
    expect(html).toContain("Posted: 12 muffins · 9 ingredients · Prep 15 min · Cook 25 min · Total 40 min");
    expect(html).toContain("<strong>Example Kitchen</strong> by Sam");
    expect(html).toContain(`href="${URL}" target="_blank" rel="noreferrer">View original`);
    expect(html).toMatch(/<strong>Contains:<\/strong><ul class="chips"><li class="chip chip-allergen">gluten<\/li><li class="chip chip-allergen">egg<\/li><li class="chip chip-allergen">milk<\/li><\/ul>/);
    expect(html).toMatch(/<strong>May contain:<\/strong><ul class="chips"><li class="chip chip-allergen chip-trace">nuts<\/li>/);
    expect(html).toContain("Check labels.");
    expect(html).not.toContain("What you&#x27;ll do");
    expect(html).not.toContain("Adjust this recipe");
  });

  it("never calls a recipe allergen-free: no tags means unknown", () => {
    const html = render(stateAfter({ type: "facts", facts: { ...FACTS, allergens: [], traces: [] } }));
    expect(html).toContain("Allergen information is unknown.");
    expect(html).toContain("Check labels.");
    expect(html).not.toMatch(/allergen-free|no allergens|free of/i);
    expect(html).not.toContain("May contain");
  });

  it("adds the overview: what you'll do and each component with how it is made", () => {
    const html = render(withOverview);
    expect(html).toContain("Laying out the prep…");
    expect(html).toContain("What you&#x27;ll do");
    expect(html).toContain(OVERVIEW.summary);
    expect(html).toContain("<strong>Porridge</strong><span>Toast the oats, then simmer in milk until thick.</span>");
    expect(html).toContain("<strong>Apples</strong>");
  });

  it("adds adjustments (queued until ready), ingredients and before you start with the recipe", () => {
    const html = render(withRecipe);
    expect(html).toContain("Writing the steps…");
    expect(html).toContain("Adjust this recipe");
    expect(html).toContain("still being written");
    expect(html).toContain("Servings (now 2)");
    expect(html).toContain("Apply when ready");
    expect(html).toContain(">Ingredients<");
    expect(html).toContain("rolled oats");
    expect(html).toContain('aria-label="Before you start"');
    expect(html).toContain("<li>saucepan</li>");
    // No timeline yet: no time-to-serve line, no prep or steps.
    expect(html).not.toContain("min hands-on");
    expect(html).not.toContain("Prep (Mise en Place style)");
    expect(html).not.toContain(">Steps<");
    // The posted yield from the page stays over the recipe's bare number.
    expect(html).toContain("Posted: 12 muffins");
  });

  it("shows queued adjustments with a way to cancel them", () => {
    const queued: AdjustChoices = { servings: 4, dietary: "gluten-free", cuisine: "", sousVoice: false };
    const html = render(withRecipe, queued);
    expect(html).toContain("<strong>Will apply when ready:</strong> serves 2 → 4 · Gluten-free");
    expect(html).toContain("Cancel changes");
    expect(html).toContain('value="4"');
  });

  it("adds prep and the essential steps with the procedure, still being checked, with no timeline graphic", () => {
    const html = render(withProcedure);
    expect(html).toContain("Checking against the original…");
    expect(html).toContain("<h3>Prep (Mise en Place style)</h3>");
    expect(html).toContain("<h3>Steps</h3>");
    expect(html).toMatch(/min hands-on · One cook/);
    expect(html).toContain('class="meta progressive-checking"');
    expect(html).not.toContain('class="timer"');
    expect(html).not.toContain(">Timeline<");
    expect(html).not.toContain('class="card timeline"');
    // No tips or why lines in this procedure: no "With tips" choice yet.
    expect(html).not.toContain("With tips");
  });

  it("offers With tips once tips or why lines exist", () => {
    const tasks = TIMELINE.tasks.map((t, i) => (i === 1 ? { ...t, tip: "Stir from the edges.", why: "Even cooking." } : t));
    const html = render(reduceConversion(withRecipe, { type: "procedure", timeline: { ...TIMELINE, tasks } }));
    expect(html).toContain("With tips");
    expect(html).toContain("Tip: Stir from the edges.");
    expect(html).toContain("Why: Even cooking.");
  });

  it("keeps the owner's order: line, facts, overview, adjustments, ingredients, before you start, prep, steps", () => {
    const html = render(withProcedure);
    const order = [
      'class="cooking-line"',
      'aria-label="About this recipe"',
      'aria-label="Allergens"',
      "What you&#x27;ll do",
      "Adjust this recipe",
      ">Ingredients<",
      'aria-label="Before you start"',
      "Prep (Mise en Place style)",
      "<h3>Steps</h3>",
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("knows a confirmed photo recipe at once: facts, adjustments and ingredients", () => {
    const html = render(reduceConversion(initialConversionState, { type: "start", body: { recipe: RECIPE } }));
    expect(html).toContain(`<h2 class="recipe-title">${RECIPE.title}</h2>`);
    expect(html).toContain("Posted: serves 2");
    expect(html).toContain("Adjust this recipe");
    expect(html).toContain("rolled oats");
  });
});

describe("facts line", () => {
  it("reads a bare number as servings and long times in hours", () => {
    expect(
      factsLine({ servingsText: "4", ingredientCount: 1, minutes: { prep: null, cook: 90, total: 120 } }),
    ).toBe("Posted: serves 4 · 1 ingredient · Cook 1 hr 30 min · Total 2 hr");
    expect(factsLine({ servingsText: null, ingredientCount: null, minutes: { prep: null, cook: null, total: null } })).toBe("");
  });
});

describe("cooking line", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("is one line of icons, hidden from screen readers, with a live status and the elapsed time", () => {
    const html = renderToString(createElement(CookingLine, { status: "Summarizing" })).replace(/<!-- -->/g, "");
    expect(html).toContain('<ul class="cooking-line-icons" aria-hidden="true">');
    expect(html.match(/class="cooking-line-icon"/g)).toHaveLength(9);
    expect(html).toContain("<svg");
    expect(html).toContain('style="--ts-turn:0"');
    expect(html).toContain('style="--ts-turn:8"');
    expect(html).toContain('<div class="cooking-line-track" aria-hidden="true">');
    expect(html).toContain('<span role="status" aria-live="polite">Summarizing…</span>');
    expect(html).toContain("0:00");
  });

  it("stops moving under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{\s*\.cooking-line-icon,\s*\.cooking-line-runner,\s*\.progressive-in \{\s*animation: none;/);
  });

  it("shares the width in nine equal columns, so it fits 320 px", () => {
    expect(css).toMatch(/\.cooking-line-icons \{[^}]*grid-template-columns: repeat\(9, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.cooking-line-icon \{[^}]*animation-delay: calc\(var\(--ts-turn, 0\) \* 0\.4s\)/);
  });
});

describe("finished page order", () => {
  const artifact = fixtureArtifact();

  it("puts the timeline graphic last, after prep (renamed), steps and notes, above Save", () => {
    const html = renderToString(
      createElement(ArtifactViewer, {
        artifact,
        onStartOver: () => {},
        overview: OVERVIEW,
        notices: ["The page text was cut."],
      }),
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("<h3>Prep (Mise en Place style)</h3>");
    expect(html).not.toContain("<h3>Mise en Place</h3>");
    const order = [
      'class="recipe-title"',
      'aria-label="Recipe credit"',
      "Contains:",
      "What you&#x27;ll do",
      "Adjust this recipe",
      ">Ingredients<",
      'aria-label="Before you start"',
      "Prep (Mise en Place style)",
      "<h3>Steps</h3>",
      "Notes on this conversion",
      "<h3>Timeline</h3>",
      'class="btn-row save-row"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows no overview card without an overview", () => {
    const html = renderToString(createElement(ArtifactViewer, { artifact, onStartOver: () => {} }));
    expect(html).not.toContain("What you&#x27;ll do");
  });
});

describe("queued adjustments", () => {
  const artifact = fixtureArtifact();
  const queued: AdjustChoices = { servings: 4, dietary: "gluten-free", cuisine: " Thai ", sousVoice: false };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("start applying as soon as the finished page opens", () => {
    const html = renderToString(
      createElement(ArtifactViewer, { artifact, onStartOver: () => {}, queuedAdjustments: queued }),
    );
    expect(html).toContain("Adjusting…");
    expect(html).toContain("applying your changes");
    expect(html).toContain('value="4"');
    expect(html).toMatch(/<option value="gluten-free" selected="">/);
    // Nothing queued: the panel waits for the cook as before.
    const plain = renderToString(createElement(ArtifactViewer, { artifact, onStartOver: () => {} }));
    expect(plain).toContain("Apply adjustments");
    expect(plain).not.toContain("Adjusting…");
  });

  it("go out through the usual adjust request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ artifact, scaleFlags: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await requestAdjustment(artifact, queued);
    expect(res.ok).toBe(true);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/adjust");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ servings: 4, dietary: "gluten-free", cuisine: "Thai" });
    expect(body).not.toHaveProperty("voice");
    expect((body.artifact as { id: string }).id).toBe(artifact.id);
  });

  it("send only what changed, and read back as one line", () => {
    const same: AdjustChoices = { servings: artifact.recipe.servings, dietary: "", cuisine: "", sousVoice: false };
    expect(hasAdjustment(same, artifact.recipe.servings)).toBe(false);
    expect(Object.keys(adjustRequestBody(artifact, same))).toEqual(["artifact"]);
    expect(adjustRequestBody(artifact, { ...same, sousVoice: true }).voice).toBe("sous");
    expect(adjustSummary(2, queued)).toBe("serves 2 → 4 · Gluten-free · Thai style");
  });
});

describe("where the progressive view shows", () => {
  it("replaces the progress note in the /embed overlay while converting", () => {
    const html = renderToString(
      createElement(EmbedStatus, { state: { kind: "converting", url: "https://www.example.com/soup" } }),
    );
    expect(html).toContain("Turning this recipe into a Cook Along");
    expect(html).toContain('class="cooking-line"');
    expect(html).not.toContain("Usually 3 to 4 minutes");
  });

  it("leaves the home page form as it was until a conversion starts", () => {
    const html = renderToString(createElement(ConverterForm, { initialUrl: "", initialSrc: "" }));
    expect(html).toContain('aria-label="Convert a recipe"');
    expect(html).not.toContain("cooking-line");
  });
});
