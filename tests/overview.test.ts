import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StructuredChatClient } from "../src/lib/model/structured";
import type { RecipeFacts } from "../src/lib/convert-events";
import { canonicalizeSourcePrompt, type RecordingFile } from "../src/lib/stages/canonicalize";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import {
  clampText,
  fillFacts,
  overview,
  OVERVIEW_MAX_TOKENS,
  OVERVIEW_SCHEMA_NAME,
  OVERVIEW_VERSION,
  OverviewSchema,
} from "../src/lib/stages/overview";

interface Call {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  response_format: { type: string; json_schema?: { name: string; schema: Record<string, unknown> } };
  max_completion_tokens?: number;
  reasoning_effort?: string;
}

function fake(replies: string[], calls: Call[] = []): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params: Call) => {
          calls.push(params);
          return {
            choices: [{ message: { content: replies.shift() ?? "{}" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          };
        },
      },
    },
  } as unknown as StructuredChatClient;
}

const corn = JSON.parse(readFileSync("eval/recordings/charred-corn-salad.json", "utf8")) as RecordingFile;
const cornRecipe = (
  JSON.parse(readFileSync("eval/recordings/procedure-charred-corn-salad.json", "utf8")) as ProcedureRecordingFile
).recipe;

const CORN_OVERVIEW = {
  title: "Charred Corn and Lime Salad Recipe",
  servingsText: "Serves 4 as a side dish",
  ingredientCount: 5,
  totalMinutes: null,
  allergens: [],
  summary: "You'll char the corn on a hot grill, then toss the kernels with lime, cilantro and salt.",
  components: [
    { name: "Corn", how: "Brushed with olive oil and charred on a hot grill." },
    { name: "Dressing", how: "Lime juice, cilantro and salt tossed through the kernels." },
  ],
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
  delete process.env.REASONING_EFFORT_OVERVIEW;
});
afterEach(() => {
  if (saved === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = saved;
});

describe("overview stage", () => {
  it("makes one fast call on the same source text canonicalize reads", async () => {
    expect(OVERVIEW_VERSION).toBe(1);
    const calls: Call[] = [];
    const result = await overview({ input: corn.input }, { client: fake([JSON.stringify(CORN_OVERVIEW)], calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0].reasoning_effort).toBe("minimal");
    expect(calls[0].max_completion_tokens).toBe(OVERVIEW_MAX_TOKENS);
    expect(calls[0].response_format.json_schema?.name).toBe(OVERVIEW_SCHEMA_NAME);
    expect(calls[0].messages[1].content).toBe(canonicalizeSourcePrompt(corn.input));
    expect(String(calls[0].messages[0].content)).toMatch(/never invent/i);
    expect(String(calls[0].messages[0].content)).toMatch(/no health or nutrition claims/i);
    expect(result.usage.totalTokens).toBe(150);
    expect(result.facts).toEqual({
      title: "Charred Corn and Lime Salad",
      source: {
        kind: "url",
        url: "https://example.com/recipes/charred-corn-salad",
        site: "TextSous Fixtures",
        author: "TextSous Kitchen",
      },
      servingsText: "Serves 4 as a side dish",
      ingredientCount: 5,
      minutes: { prep: null, cook: null, total: null },
      allergens: [],
      traces: [],
    });
    expect(result.overview).toEqual({ summary: CORN_OVERVIEW.summary, components: CORN_OVERVIEW.components });
  });

  it("reads a confirmed recipe on the photo path and honors an effort override", async () => {
    const calls: Call[] = [];
    await overview(
      { recipe: cornRecipe },
      { client: fake([JSON.stringify(CORN_OVERVIEW)], calls), efforts: { overview: "low" } },
    );
    const user = JSON.parse(String(calls[0].messages[1].content)) as { ingredients: Array<{ name: string }> };
    expect(user.ingredients.map((i) => i.name)).toEqual(["corn", "olive oil", "lime", "cilantro", "kosher salt"]);
    expect(calls[0].reasoning_effort).toBe("low");
  });

  it("keeps the schema closed and clamps long text in code", async () => {
    const json = OverviewSchema.safeParse({ ...CORN_OVERVIEW, extra: 1 });
    expect(json.success).toBe(false);
    expect(OverviewSchema.safeParse({ ...CORN_OVERVIEW, allergens: ["peanut"] }).success).toBe(false);
    expect(OverviewSchema.safeParse({ ...CORN_OVERVIEW, components: [] }).success).toBe(false);
    const long = {
      ...CORN_OVERVIEW,
      allergens: ["milk", "gluten", "milk"],
      totalMinutes: 35,
      summary: `${"You'll whisk the batter and fold in the berries. ".repeat(8)}`,
      components: Array.from({ length: 8 }, (_, i) => ({
        name: `A very long component name number ${i} that keeps going`,
        how: "Mixed.",
      })),
    };
    const result = await overview({ input: corn.input }, { client: fake([JSON.stringify(long)]) });
    expect(result.overview.summary.length).toBeLessThanOrEqual(280);
    expect(result.overview.summary.endsWith("…")).toBe(true);
    expect(result.overview.components).toHaveLength(6);
    expect(result.overview.components.every((c) => c.name.length <= 40)).toBe(true);
    expect(result.facts.allergens).toEqual(["gluten", "milk"]);
    expect(result.facts.minutes.total).toBe(35);
    expect(clampText("short", 10)).toBe("short");
  });

  it("re-prompts once on an invalid reply and fails cleanly on junk", async () => {
    const calls: Call[] = [];
    const ok = await overview(
      { input: corn.input },
      { client: fake([JSON.stringify({ ...CORN_OVERVIEW, components: [] }), JSON.stringify(CORN_OVERVIEW)], calls) },
    );
    expect(calls).toHaveLength(2);
    expect(ok.overview.components).toHaveLength(2);
    await expect(overview({ input: corn.input }, { client: fake(["nope", "nope", "nope"]) })).rejects.toThrow(
      /valid JSON/,
    );
  });
});

describe("fillFacts", () => {
  it("keeps what the page states and lets the overview fill the gaps", () => {
    const page: RecipeFacts = {
      title: "Blueberry Muffins",
      source: { kind: "url", url: "https://example.com/m", site: "example.com", author: null },
      servingsText: "12 muffins",
      ingredientCount: 9,
      minutes: { prep: 15, cook: null, total: null },
      allergens: ["gluten"],
      traces: ["nuts"],
    };
    const model: RecipeFacts = {
      title: "Muffins",
      source: { kind: "url", url: null, site: null, author: "Sam" },
      servingsText: "12",
      ingredientCount: 10,
      minutes: { prep: null, cook: null, total: 40 },
      allergens: ["egg", "nuts"],
      traces: [],
    };
    expect(fillFacts(page, model)).toEqual({
      title: "Blueberry Muffins",
      source: { kind: "url", url: "https://example.com/m", site: "example.com", author: "Sam" },
      servingsText: "12 muffins",
      ingredientCount: 9,
      minutes: { prep: 15, cook: null, total: 40 },
      allergens: ["gluten", "egg", "nuts"],
      traces: [],
    });
    expect(fillFacts(null, model)).toBe(model);
  });
});
