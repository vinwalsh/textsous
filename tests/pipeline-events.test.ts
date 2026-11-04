import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StructuredChatClient } from "../src/lib/model/structured";
import { runWithModelBudget } from "../src/lib/model/budget";
import type { ConvertEvent } from "../src/lib/convert-events";
import type { RecordingFile } from "../src/lib/stages/canonicalize";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { convertRecipeToArtifact, convertToArtifact, type PipelineOptions } from "../src/lib/pipeline";

// Offline: every stage gets a fake transport replaying the recorded charred
// corn salad (canonicalize and procedure), all-pass judgments and a scripted
// overview. Delays order the replies the way a live run usually does.

const corn = JSON.parse(readFileSync("eval/recordings/charred-corn-salad.json", "utf8")) as RecordingFile;
const procRecording = JSON.parse(
  readFileSync("eval/recordings/procedure-charred-corn-salad.json", "utf8"),
) as ProcedureRecordingFile;

const JUDGMENTS = JSON.stringify({
  checks: [
    "source_fidelity",
    "quantities",
    "dietary_conditions",
    "method_and_safety",
    "equipment_capacity",
    "source_relationships",
    "tips_and_voice",
  ].map((name) => ({ name, passed: true, detail: "ok" })),
});

const OVERVIEW = JSON.stringify({
  title: "Charred Corn and Lime Salad",
  servingsText: "Serves 4 as a side dish",
  ingredientCount: 5,
  totalMinutes: 15,
  allergens: [],
  summary: "You'll char the corn on a hot grill, then toss the kernels with lime, cilantro and salt.",
  components: [{ name: "Corn", how: "Brushed with olive oil and charred on a hot grill." }],
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fake(
  content: string | (() => never),
  opts: { delayMs?: number; tokens?: number; calls?: string[]; name?: string } = {},
): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params) => {
          opts.calls?.push(`${opts.name ?? "call"}:${params.reasoning_effort ?? "-"}`);
          if (opts.delayMs) await sleep(opts.delayMs);
          const body = typeof content === "function" ? content() : content;
          const tokens = opts.tokens ?? 10;
          return {
            choices: [{ message: { content: body }, finish_reason: "stop" }],
            usage: { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens },
          };
        },
      },
    },
  };
}

function clients(overrides: Partial<NonNullable<PipelineOptions["clients"]>> = {}, calls?: string[]) {
  return {
    overview: fake(OVERVIEW, { tokens: 7, calls, name: "overview" }),
    canonicalize: fake(corn.response, { delayMs: 20, tokens: 100, calls, name: "canonicalize" }),
    procedure: fake(procRecording.response, { delayMs: 5, tokens: 1000, calls, name: "procedure" }),
    review: fake(JUDGMENTS, { tokens: 10_000, calls, name: "review" }),
    ...overrides,
  };
}

const textInput = {
  source: { kind: "text" as const },
  rawText: corn.input.rawText,
  ingredientLines: [],
  instructionLines: [],
  hasJsonLd: false,
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = saved;
});

describe("pipeline progress events", () => {
  it("sends facts, overview, recipe and procedure in order, and counts the overview's tokens", async () => {
    const events: ConvertEvent[] = [];
    const calls: string[] = [];
    const result = await convertToArtifact(textInput, {
      clients: clients({}, calls),
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual(["facts", "overview", "recipe", "procedure"]);
    const [facts, , recipe, procedure] = events;
    expect(facts).toMatchObject({
      type: "facts",
      facts: { title: "Charred Corn and Lime Salad", servingsText: "Serves 4 as a side dish", minutes: { total: 15 } },
    });
    // The recipe's facts keep the posted yield and the stated time, with the recipe's count.
    expect(recipe).toMatchObject({
      type: "recipe",
      recipe: { title: "Charred Corn and Lime Salad" },
      facts: { servingsText: "Serves 4 as a side dish", ingredientCount: 5, minutes: { total: 15 } },
    });
    expect(procedure.type === "procedure" && procedure.timeline.tasks.length).toBeGreaterThan(0);
    expect(result.usageTotal.totalTokens).toBe(7 + 100 + 1000 + 10_000);
    expect(result.overview).toMatchObject({ status: "ok", usage: { totalTokens: 7 } });
    expect(result.efforts).toEqual({ overview: "minimal", canonicalize: "low", procedure: "low", review: "low" });
    expect(calls.sort()).toEqual(["canonicalize:low", "overview:minimal", "procedure:low", "review:low"]);
  });

  it("sends a page's facts before any model call, then the overview's additions", async () => {
    const events: ConvertEvent[] = [];
    await convertToArtifact(corn.input, {
      clients: clients(),
      jsonLd: {
        name: "Charred Corn and Lime Salad",
        recipeYield: "4 servings",
        recipeIngredient: ["4 ears corn", "1 tablespoon olive oil", "1 lime", "1/4 cup cilantro", "1/2 teaspoon kosher salt"],
        recipeInstructions: ["Char.", "Toss."],
      },
      onEvent: (e) => {
        events.push(e);
      },
    });
    expect(events.map((e) => e.type)).toEqual(["facts", "facts", "overview", "recipe", "procedure"]);
    const first = events[0].type === "facts" ? events[0].facts : null;
    const second = events[1].type === "facts" ? events[1].facts : null;
    expect(first).toMatchObject({ servingsText: "4 servings", ingredientCount: 5, minutes: { total: null } });
    // The page's yield stays; the overview adds the stated total time.
    expect(second).toMatchObject({ servingsText: "4 servings", ingredientCount: 5, minutes: { total: 15 } });
  });

  it("runs no overview and sends nothing without a listener (JSON mode)", async () => {
    const calls: string[] = [];
    const result = await convertToArtifact(textInput, { clients: clients({}, calls) });
    expect(calls.some((c) => c.startsWith("overview"))).toBe(false);
    expect(result.overview).toBeUndefined();
    expect(result.usageTotal.totalTokens).toBe(100 + 1000 + 10_000);
    expect(result.efforts).toEqual({ canonicalize: "low", procedure: "low", review: "low" });
    expect(Object.keys(result.timings)).toEqual(["canonicalizeMs", "procedureMs", "reviewMs"]);
  });

  it("never fails or waits for a failed or slow overview", async () => {
    const failing = fake(() => {
      throw Object.assign(new Error("upstream 400"), { status: 400 });
    });
    const events: ConvertEvent[] = [];
    const failed = await convertToArtifact(textInput, {
      clients: clients({ overview: failing }),
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual(["recipe", "procedure"]);
    expect(failed.overview?.status).toBe("failed");
    expect(failed.usageTotal.totalTokens).toBe(100 + 1000 + 10_000);

    const late: ConvertEvent[] = [];
    const slow = await convertToArtifact(textInput, {
      clients: clients({ overview: fake(OVERVIEW, { delayMs: 200, tokens: 7 }) }),
      onEvent: (e) => late.push(e),
    });
    expect(slow.overview?.status).toBe("pending");
    expect(slow.usageTotal.totalTokens).toBe(100 + 1000 + 10_000);
    await sleep(250);
    // Nothing goes out after compile.
    expect(late.map((e) => e.type)).toEqual(["recipe", "procedure"]);
  });

  it("sends the overview when it arrives, even after the recipe", async () => {
    const events: ConvertEvent[] = [];
    await convertToArtifact(textInput, {
      clients: clients({
        overview: fake(OVERVIEW, { delayMs: 30 }),
        canonicalize: fake(corn.response),
        procedure: fake(procRecording.response, { delayMs: 60 }),
      }),
      onEvent: (e) => events.push(e),
    });
    // Its facts are not sent after the recipe's (the recipe's are better).
    expect(events.map((e) => e.type)).toEqual(["recipe", "overview", "procedure"]);
  });

  it("keeps converting when the listener throws", async () => {
    let seen = 0;
    const result = await convertToArtifact(textInput, {
      clients: clients(),
      onEvent: () => {
        seen += 1;
        throw new Error("stream closed");
      },
    });
    expect(seen).toBe(4);
    expect(result.artifact.recipe.title).toBe("Charred Corn and Lime Salad");
  });

  it("starts the photo-confirm path with the recipe's facts and the recipe", async () => {
    const events: ConvertEvent[] = [];
    const calls: string[] = [];
    const result = await convertRecipeToArtifact(procRecording.recipe, {
      clients: clients({ procedure: fake(procRecording.response, { delayMs: 20, calls, name: "procedure" }) }, calls),
      efforts: { procedure: "minimal" },
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual(["facts", "recipe", "overview", "procedure"]);
    expect(events[0]).toMatchObject({ type: "facts", facts: { servingsText: "4", ingredientCount: 5 } });
    expect(result.efforts).toEqual({ overview: "minimal", procedure: "minimal", review: "low" });
    expect(calls).toContain("procedure:minimal");
    expect(calls.some((c) => c.startsWith("canonicalize"))).toBe(false);
  });

  it("runs the overview inside the route's budget", async () => {
    const { budget, result } = runWithModelBudget(
      () => convertToArtifact(textInput, { clients: clients(), onEvent: () => {} }),
      { deadlineMs: 400_000 },
    );
    const done = await result;
    expect(done.overview?.status).toBe("ok");
    expect(budget.spent).toBe(true);
  });
});
