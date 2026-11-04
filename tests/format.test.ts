import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanCardTitle,
  cleanTitle,
  firstSentence,
  normalizeFractions,
  lowerMidSentenceQuantities,
  polishTimeline,
  prepNoteOf,
  sourceTimingInDescription,
  runFormatWarnings,
  stripAmountsTimesTemps,
} from "../src/lib/format";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import { TimelineDefinitionSchema, type TimelineDefinition, type TimelineTask } from "../src/lib/schema/timeline";
import { schedule } from "../src/lib/scheduler/schedule";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";

describe("cleanTitle", () => {
  it.each([
    ["Beef Stroganoff Recipe", "The Modern Proper", "Beef Stroganoff"],
    ["Maple Glazed Salmon | The Recipe Critic", "The Recipe Critic", "Maple Glazed Salmon"],
    ["Pasta e Fagioli - Smitten Kitchen", "smittenkitchen.com", "Pasta e Fagioli"],
    ["The BEST Maple-Glazed Salmon (Easy!) 🐟", null, "Maple-Glazed Salmon"],
    ["Easy! Weeknight Chili - Best Ever", null, "Weeknight Chili"],
    ["Best Ever Banana Bread Recipe", null, "Banana Bread"],
    ["Recipe: Lemon Bars", null, "Lemon Bars"],
    ["Chicken Tikka Masala (Video)", null, "Chicken Tikka Masala"],
    ["🍝 Weeknight Pasta 🍝", null, "Weeknight Pasta"],
  ])("%s -> %s", (raw, site, expected) => {
    expect(cleanTitle(raw, site)).toBe(expected);
  });

  it("keeps real names, letter case and informative parentheses", () => {
    expect(cleanTitle("Simple Chicken Tacos", "smitten kitchen")).toBe("Simple Chicken Tacos");
    expect(cleanTitle("Herby White Bean Toast")).toBe("Herby White Bean Toast");
    expect(cleanTitle("Grandma's Apple Pie")).toBe("Grandma's Apple Pie");
    expect(cleanTitle("Pad Thai (Gluten-Free)")).toBe("Pad Thai (Gluten-Free)");
    expect(cleanTitle("Maple-Glazed Salmon")).toBe("Maple-Glazed Salmon");
  });

  it("never returns an empty title", () => {
    expect(cleanTitle("Perfect")).toBe("Perfect");
    expect(cleanTitle("Recipe")).toBe("Recipe");
  });

  it("is idempotent", () => {
    const once = cleanTitle("The Best Easy Beef Stroganoff Recipe | The Modern Proper", "The Modern Proper");
    expect(cleanTitle(once, "The Modern Proper")).toBe(once);
  });
});

describe("normalizeFractions", () => {
  it("writes unicode and hyphenated fractions as plain text", () => {
    expect(normalizeFractions("1½ cups, ¼ tsp, 1-1/2 lb, 1⁄2 cup")).toBe(
      "1 1/2 cups, 1/4 tsp, 1 1/2 lb, 1/2 cup",
    );
  });
});

describe("card title cleanup", () => {
  it("removes amounts, times and temperatures", () => {
    expect(cleanCardTitle({ action: "Sear", subject: "1 1/2 pounds beef", context: "for 2 minutes per side" })).toEqual({
      action: "Sear",
      subject: "beef",
      context: "",
    });
    expect(cleanCardTitle({ action: "Bake", subject: "the salmon", context: "at 400°F for 12-15 minutes" })).toEqual({
      action: "Bake",
      subject: "the salmon",
      context: "",
    });
    expect(cleanCardTitle({ action: "Season", subject: "Beef", context: "with 1½ teaspoons salt" })).toEqual({
      action: "Season",
      subject: "Beef",
      context: "with salt",
    });
    expect(stripAmountsTimesTemps("into 1-inch pieces")).toBe("into pieces");
    expect(stripAmountsTimesTemps("to 425 degrees F")).toBe("");
  });

  it("leaves clean titles alone and never empties action or subject", () => {
    const card = { action: "Cook", subject: "garlic", context: "until fragrant" };
    expect(cleanCardTitle(card)).toEqual(card);
    expect(cleanCardTitle({ action: "Add", subject: "2 cups", context: "" }).subject).toBe("2 cups");
  });
});

describe("firstSentence", () => {
  it("keeps one sentence", () => {
    expect(firstSentence("Browning builds flavor. It also helps the sauce.")).toBe(
      "Browning builds flavor.",
    );
    expect(firstSentence("No period here")).toBe("No period here");
    expect(firstSentence("  ")).toBeNull();
    expect(firstSentence(null)).toBeNull();
  });
});

describe("prepNoteOf", () => {
  it("finds preparations in notes and names", () => {
    expect(prepNoteOf({ name: "yellow onion", note: "diced" })).toBe("diced");
    expect(prepNoteOf({ name: "chopped parsley", note: null })).toBe("chopped");
    expect(prepNoteOf({ name: "butter", note: "at room temperature" })).toBe("at room temperature");
    expect(prepNoteOf({ name: "beef stock", note: null })).toBeNull();
    expect(prepNoteOf({ name: "salt", note: "divided" })).toBeNull();
  });
});

// An original mini recipe written for these tests.
function recipe(): CanonicalRecipe {
  return {
    version: 1,
    id: "rcp-test",
    title: "Skillet Mushrooms on Rice",
    source: { kind: "text" },
    nativeServings: 2,
    ingredients: [
      { id: "ing-1", name: "mushrooms", quantity: "1", unit: "pound", note: "sliced", allergens: [], allergenTraces: [] },
      { id: "ing-2", name: "kosher salt", quantity: "1", unit: "teaspoon", note: "divided", allergens: [], allergenTraces: [] },
      { id: "ing-3", name: "garlic", quantity: "2", unit: "cloves", note: "minced", allergens: [], allergenTraces: [] },
      { id: "ing-4", name: "olive oil", quantity: "1½", unit: "tablespoons", note: null, allergens: [], allergenTraces: [] },
      { id: "ing-5", name: "cooked rice", quantity: "2", unit: "cups", note: "for serving", allergens: [], allergenTraces: [] },
      { id: "ing-6", name: "black pepper", quantity: "", unit: "", note: "to taste", scaleRule: "to-taste", allergens: [], allergenTraces: [] },
    ],
    steps: [
      { id: "step-1", kind: "active", text: "Heat the oil in a skillet. Cook the mushrooms in 2 batches, about 3 minutes per batch, seasoning with half the salt." },
      { id: "step-2", kind: "active", text: "Add the garlic and the rest of the salt and cook for 1 minute." },
      { id: "step-3", kind: "active", text: "Serve over rice with pepper." },
    ],
    equipment: ["large skillet"],
    sourceFingerprint: "fp-test",
  };
}

function task(id: string, over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id,
    phase: "cook",
    label: id,
    cardTitle: { action: "Cook", subject: id, context: "" },
    description: "Do it.",
    completionCue: "Done.",
    minutes: 2,
    range: null,
    timingBasis: "estimate",
    sourceQuote: null,
    attention: "hands-on",
    timerEnabledByDefault: false,
    laneIds: ["lane-main"],
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

function timeline(tasks: TimelineTask[]): TimelineDefinition {
  return {
    lanes: [
      { id: "lane-main", label: "Mushrooms", color: "#587454", kind: "component" },
      { id: "lane-base", label: "Rice", color: "#B58D3D", kind: "component" },
      { id: "lane-kitchen", label: "Kitchen", color: "#AAA398", kind: "kitchen" },
    ],
    tasks,
    resources: [],
    resourceHolds: [],
    serveTaskId: tasks[tasks.length - 1].id,
  };
}

/** The shape the format rules ask for: prep first, amounts in text, batches grouped. */
function goodTimeline(): TimelineDefinition {
  return timeline([
    task("task-slice", {
      phase: "prep",
      label: "Slice the mushrooms and mince the garlic",
      description: "Slice 1 pound mushrooms and mince 2 cloves garlic.",
      sourceStepIds: ["step-1"],
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-1", "ing-3"] },
    }),
    task("task-rice", {
      phase: "cook",
      label: "Have the rice ready",
      description: "Cook 2 cups cooked rice worth of rice so it is ready to serve.",
      attention: "unattended",
      minutes: 20,
      laneIds: ["lane-base"],
      sourceStepIds: ["step-3"],
      dependencies: ["task-slice"],
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-5"] },
    }),
    task("task-sear", {
      label: "Brown the mushrooms",
      cardTitle: { action: "Brown", subject: "the mushrooms", context: "in 2 batches, 3 minutes per batch" },
      description:
        "Heat 1 1/2 tablespoons olive oil, then cook the mushrooms in 2 batches, about 3 minutes per batch, seasoning with 1/2 teaspoon of the salt.",
      minutes: 6,
      dependencies: ["task-slice"],
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-4", "ing-1", "ing-2"] },
    }),
    task("task-garlic", {
      label: "Cook the garlic",
      description: "Add the garlic and the remaining 1/2 teaspoon salt.",
      timingBasis: "source",
      sourceQuote: "for 1 minute",
      timerEnabledByDefault: false,
      minutes: 1,
      dependencies: ["task-sear"],
      sourceStepIds: ["step-2"],
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-3", "ing-2"] },
    }),
    task("task-serve", {
      phase: "finish",
      label: "Serve",
      description: "Spoon the mushrooms over the rice and season with black pepper.",
      dependencies: ["task-garlic", "task-rice"],
      sourceStepIds: ["step-3"],
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-5", "ing-6"] },
    }),
  ]);
}

describe("polishTimeline", () => {
  it("cleans card titles, timers and timing labels without touching structure", () => {
    const { timeline: out, repairs } = polishTimeline(recipe(), goodTimeline());
    const sear = out.tasks.find((t) => t.id === "task-sear");
    expect(sear?.cardTitle).toEqual({ action: "Brown", subject: "the mushrooms", context: "in batches" });
    const garlic = out.tasks.find((t) => t.id === "task-garlic");
    expect(garlic?.timingBasis).toBe("source");
    expect(garlic?.timerEnabledByDefault).toBe(true);
    expect(repairs).toEqual([]);
    expect(out.tasks.map((t) => [t.id, t.minutes, t.dependencies])).toEqual(
      goodTimeline().tasks.map((t) => [t.id, t.minutes, t.dependencies]),
    );
  });

  it("downgrades a source timing whose quote is not verbatim, and drops quotes on estimates", () => {
    const tl = goodTimeline();
    tl.tasks[3] = { ...tl.tasks[3], sourceQuote: "for one minute" };
    tl.tasks[2] = { ...tl.tasks[2], sourceQuote: "about 3 minutes per batch" };
    const { timeline: out, repairs } = polishTimeline(recipe(), tl);
    expect(out.tasks[3].timingBasis).toBe("estimate");
    expect(out.tasks[3].sourceQuote).toBeNull();
    expect(out.tasks[3].timerEnabledByDefault).toBe(false);
    expect(out.tasks[2].sourceQuote).toBeNull();
    expect(repairs).toEqual([
      "Timing for Cook the garlic is now marked as an estimate: its quote is not word for word in the recipe.",
    ]);
  });

  it("keeps why to one sentence and turns blank tips into null", () => {
    const tl = goodTimeline();
    tl.tasks[2] = { ...tl.tasks[2], why: "Batches keep the pan hot. Crowding steams.", tip: "  " };
    const { timeline: out } = polishTimeline(recipe(), tl);
    expect(out.tasks[2].why).toBe("Batches keep the pan hot.");
    expect(out.tasks[2].tip).toBeNull();
    expect(TimelineDefinitionSchema.safeParse(out).success).toBe(true);
  });
});

describe("runFormatWarnings", () => {
  it("passes a timeline that follows the format rules", () => {
    const tl = polishTimeline(recipe(), goodTimeline()).timeline;
    expect(runFormatWarnings(recipe(), tl, schedule(tl))).toEqual([]);
  });

  it("flags an ingredient prep that no prep task covers", () => {
    const tl = goodTimeline();
    tl.tasks[0] = {
      ...tl.tasks[0],
      label: "Slice the mushrooms",
      description: "Slice 1 pound mushrooms.",
      scheduling: { waits: [], resourceIds: [], ingredientIds: ["ing-1"] },
    };
    const warnings = runFormatWarnings(recipe(), tl);
    expect(warnings.map((w) => [w.code, w.ingredientId])).toContainEqual(["prep_not_covered", "ing-3"]);
    expect(warnings.find((w) => w.code === "prep_not_covered")?.message).toBe(
      "No prep task covers the garlic (minced).",
    );
  });

  it("flags a first use without its amount, and a divided portion without one", () => {
    const tl = goodTimeline();
    tl.tasks[2] = {
      ...tl.tasks[2],
      description: "Heat the oil, then cook the mushrooms in batches, seasoning with salt.",
    };
    const codes = runFormatWarnings(recipe(), tl).filter((w) => w.code === "amount_missing");
    expect(codes.map((w) => w.ingredientId).sort()).toEqual(["ing-2", "ing-4"]);
    expect(codes[0].message).toMatch(/^"Brown the mushrooms" uses the /);
  });

  it("does not ask for amounts on to-taste items or later mentions", () => {
    const warnings = runFormatWarnings(recipe(), goodTimeline());
    expect(warnings.filter((w) => w.ingredientId === "ing-6")).toEqual([]);
    expect(warnings.filter((w) => w.taskId === "task-serve")).toEqual([]);
  });

  it("flags a batch task timed by one round's quote", () => {
    const tl = goodTimeline();
    tl.tasks[2] = { ...tl.tasks[2], timingBasis: "source", sourceQuote: "about 3 minutes per batch" };
    expect(runFormatWarnings(recipe(), tl).map((w) => w.code)).toContain("batch_round_timing");
  });

  it("is a warning, not a gate: the older recordings still parse and only warn", () => {
    for (const name of ["toasted-oat-porridge", "charred-corn-salad", "herby-white-bean-toast"]) {
      const recording = JSON.parse(
        readFileSync(`eval/recordings/procedure-${name}.json`, "utf8"),
      ) as ProcedureRecordingFile;
      const parsed = TimelineDefinitionSchema.parse(JSON.parse(recording.response));
      const polished = polishTimeline(recording.recipe, parsed).timeline;
      const warnings = runFormatWarnings(recording.recipe, polished, schedule(polished));
      // Recorded before the amounts rule: they warn, and nothing throws.
      expect(warnings.some((w) => w.code === "amount_missing")).toBe(true);
      for (const w of warnings) expect(w.message).not.toMatch(/\b(task|ing|step)-\d/);
    }
  });
});

describe("sourceTimingInDescription", () => {
  const steps = new Map([
    ["s1", "Cook until soft, about 5 minutes. Add the garlic for 1 more minute."],
    ["s2", "Brown the beef, 1 to 2 minutes per side."],
    ["s3", "Bake 3-5 minutes until done."],
  ]);
  it("labels a repeated source time phrase as the source timing", () => {
    expect(
      sourceTimingInDescription({ description: "Cook the onion until soft, about 5 minutes.", minutes: 5, sourceStepIds: ["s1"] }, steps),
    ).toEqual({ quote: "about 5 minutes" });
    expect(
      sourceTimingInDescription({ description: "Bake 3-5 minutes until done.", minutes: 4, sourceStepIds: ["s3"] }, steps),
    ).toEqual({ quote: "3-5 minutes", range: { low: 3, high: 5 } });
  });
  it("never promotes per-side times, mismatched minutes or uncited steps", () => {
    expect(
      sourceTimingInDescription({ description: "Sear in 3 batches, 1 to 2 minutes per side.", minutes: 9, sourceStepIds: ["s2"] }, steps),
    ).toBeNull();
    expect(
      sourceTimingInDescription({ description: "Cook until soft, about 5 minutes.", minutes: 6, sourceStepIds: ["s1"] }, steps),
    ).toBeNull();
    expect(
      sourceTimingInDescription({ description: "Bake 3-5 minutes.", minutes: 4, sourceStepIds: ["s1"] }, steps),
    ).toBeNull();
    expect(
      sourceTimingInDescription({ description: "Cook 5 minutes, then 1 more minute.", minutes: 5, sourceStepIds: ["s1"] }, steps),
    ).toBeNull();
  });
  it("is applied by polishTimeline", () => {
    const tl = goodTimeline();
    tl.tasks[3] = { ...tl.tasks[3], timingBasis: "estimate", sourceQuote: null, description: "Add 2 cloves garlic and the remaining 1/2 teaspoon salt and cook for 1 minute." };
    const out = polishTimeline(recipe(), tl).timeline.tasks[3];
    expect(out.timingBasis).toBe("source");
    expect(out.sourceQuote).toBe("for 1 minute");
    expect(out.timerEnabledByDefault).toBe(true);
  });
});

describe("lowerMidSentenceQuantities", () => {
  it("lowers capitalized free-text quantities mid-sentence only", () => {
    const r = recipe();
    r.ingredients[0] = { ...r.ingredients[0], quantity: "Half a" };
    expect(lowerMidSentenceQuantities("Thinly slice Half a red onion. Half a lime too.", r)).toBe(
      "Thinly slice half a red onion. Half a lime too.",
    );
  });
});
