import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  conversionStage,
  initialConversionState,
  INVALID_ARTIFACT_MESSAGE,
  reduceConversion,
  runConversion,
  type ConversionAction,
  type ConversionState,
  type ConvertBody,
} from "../src/app/conversion";
import { encodeEvent, type ConvertEvent, type RecipeFacts } from "../src/lib/convert-events";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import type { TimelineDefinition } from "../src/lib/schema/timeline";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const URL_BODY: ConvertBody = { url: "https://example.com/recipes/muffins" };
const recording = JSON.parse(
  readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
) as { recipe: CanonicalRecipe; response: string };
const RECIPE = recording.recipe;
const TIMELINE = JSON.parse(recording.response) as TimelineDefinition;
const ARTIFACT = fixtureArtifact();

function facts(over: Partial<RecipeFacts> = {}): RecipeFacts {
  return {
    title: "Blueberry Muffins",
    source: { kind: "url", url: URL_BODY.url, site: "example.com", author: null },
    servingsText: "12 muffins",
    ingredientCount: 9,
    minutes: { prep: 15, cook: 25, total: 40 },
    allergens: ["gluten"],
    traces: ["nuts"],
    ...over,
  };
}

function reduceAll(actions: ConversionAction[], state: ConversionState = initialConversionState): ConversionState {
  return actions.reduce(reduceConversion, state);
}

const working = reduceAll([{ type: "start", body: URL_BODY }]);

describe("reduceConversion", () => {
  it("starts working, remembering a URL for the error copy", () => {
    expect(working).toMatchObject({ status: "working", recipeUrl: URL_BODY.url, facts: null, recipe: null });
    expect(reduceAll([{ type: "start", body: { text: "Mix and bake." } }]).recipeUrl).toBeNull();
  });

  it("knows a confirmed photo recipe and its facts before the server answers", () => {
    const state = reduceAll([{ type: "start", body: { recipe: RECIPE } }]);
    expect(state.recipe?.title).toBe(RECIPE.title);
    expect(state.facts).toMatchObject({ title: RECIPE.title, ingredientCount: RECIPE.ingredients.length });
    expect(state.recipeUrl).toBeNull();
    // A body that is not a valid recipe seeds nothing.
    const odd = reduceAll([{ type: "start", body: { recipe: { title: "x" } as unknown as CanonicalRecipe } }]);
    expect(odd.recipe).toBeNull();
    expect(odd.facts).toBeNull();
  });

  it("merges facts: newer values win, the posted yield stays, allergens only grow", () => {
    const state = reduceAll(
      [
        { type: "facts", facts: facts() },
        {
          type: "facts",
          facts: facts({ servingsText: "12", ingredientCount: 10, allergens: ["milk", "nuts"], traces: [] }),
        },
      ],
      working,
    );
    expect(state.facts).toMatchObject({
      servingsText: "12 muffins",
      ingredientCount: 10,
      allergens: ["gluten", "milk", "nuts"],
      traces: [],
    });
  });

  it("takes the overview, and ignores one that is not an overview", () => {
    const overview = { summary: "Mix, fill the tin, bake.", components: [{ name: "Batter", how: "Whisk, then fold." }] };
    expect(reduceAll([{ type: "overview", overview }], working).overview).toEqual(overview);
    const junk = { type: "overview", overview: { summary: 3 } } as unknown as ConversionAction;
    expect(reduceAll([junk], working).overview).toBeNull();
  });

  it("takes the recipe with its facts, keeping earlier facts", () => {
    const state = reduceAll(
      [
        { type: "facts", facts: facts({ title: null }) },
        { type: "recipe", recipe: RECIPE, facts: facts({ title: RECIPE.title, servingsText: "2", traces: [] }) },
      ],
      working,
    );
    expect(state.recipe?.id).toBe(RECIPE.id);
    expect(state.facts).toMatchObject({ title: RECIPE.title, servingsText: "12 muffins", traces: ["nuts"] });
    // An invalid recipe keeps what was there, but its facts still count.
    const odd = reduceAll(
      [{ type: "recipe", recipe: { id: "x" } as unknown as CanonicalRecipe, facts: facts({ allergens: ["egg"] }) }],
      working,
    );
    expect(odd.recipe).toBeNull();
    expect(odd.facts?.allergens).toEqual(["egg"]);
  });

  it("takes the procedure's timeline before the review, and ignores an invalid one", () => {
    expect(reduceAll([{ type: "procedure", timeline: TIMELINE }], working).timeline?.tasks).toHaveLength(6);
    const junk = { type: "procedure", timeline: { lanes: [] } } as unknown as ConversionAction;
    expect(reduceAll([junk], working).timeline).toBeNull();
  });

  it("finishes with a valid artifact, its warnings as notices", () => {
    const state = reduceAll(
      [{ type: "done", artifact: ARTIFACT, cached: true, warnings: ["Timings relabeled.", ""] }],
      working,
    );
    expect(state).toMatchObject({ status: "done", cached: true, notices: ["Timings relabeled."], error: null });
    expect(state.artifact?.id).toBe(ARTIFACT.id);
  });

  it("fails calmly when the finished artifact is not valid, as before streaming", () => {
    const bad = { ...ARTIFACT, formatVersion: 2 } as unknown as typeof ARTIFACT;
    const state = reduceAll([{ type: "done", artifact: bad, cached: false, warnings: [] }], working);
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ title: "Something went wrong", detail: INVALID_ARTIFACT_MESSAGE });
  });

  it("maps an error event with the same options as the JSON answers", () => {
    const cap = reduceAll(
      [{ type: "error", status: 429, error: "Daily conversion limit reached.", reason: "daily_cap" }],
      working,
    );
    expect(cap.status).toBe("failed");
    expect(cap.error?.action).toBe("assistants");
    expect(cap.error?.href).toBe(`/assistants?url=${encodeURIComponent(URL_BODY.url)}`);
    const blocked = reduceAll([{ type: "error", status: 422, error: "compile blocked: quantities: 2 cups" }], working);
    expect(blocked.error?.title).toBe("We couldn't double-check this one");
    expect(blocked.error?.more).toBe("quantities: 2 cups");
    const slow = reduceAll([{ type: "error", status: 503, error: "took too long to convert" }], working);
    expect(slow.error?.title).toBe("That took too long");
    const text = reduceAll([
      { type: "start", body: { text: "Mix." } },
      { type: "error", status: 429, error: "", reason: "daily_cap" },
    ]);
    expect(text.error?.href).toBe("/assistants");
  });

  it("ignores events after done or an error, and unknown event types", () => {
    const done = reduceAll([{ type: "done", artifact: ARTIFACT, cached: false, warnings: [] }], working);
    expect(reduceAll([{ type: "error", status: 500, error: "late" }], done)).toBe(done);
    expect(reduceAll([{ type: "facts", facts: facts() }], done)).toBe(done);
    const failed = reduceAll([{ type: "error", status: 500, error: "" }], working);
    expect(reduceAll([{ type: "overview", overview: { summary: "s", components: [] } }], failed)).toBe(failed);
    const future = { type: "nutrition", value: 1 } as unknown as ConversionAction;
    expect(reduceAll([future], working)).toBe(working);
    expect(reduceAll([{ type: "reset" }], done)).toEqual(initialConversionState);
    expect(reduceAll([{ type: "failed", error: { title: "x", detail: "y" } }], done)).toBe(done);
  });

  it("names the stage by the furthest part that arrived", () => {
    expect(conversionStage(working)).toBe("Reading the recipe");
    const withFacts = reduceAll([{ type: "facts", facts: facts() }], working);
    expect(conversionStage(withFacts)).toBe("Summarizing");
    const withOverview = reduceAll([{ type: "overview", overview: { summary: "s", components: [] } }], withFacts);
    expect(conversionStage(withOverview)).toBe("Laying out the prep");
    const withRecipe = reduceAll([{ type: "recipe", recipe: RECIPE, facts: facts() }], withFacts);
    expect(conversionStage(withRecipe)).toBe("Writing the steps");
    const withTimeline = reduceAll([{ type: "procedure", timeline: TIMELINE }], withRecipe);
    expect(conversionStage(withTimeline)).toBe("Checking against the original");
    expect(conversionStage({ ...withTimeline, status: "done" })).toBe("Building your cook along");
  });
});

function ndjson(events: Array<ConvertEvent | string>, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const line = typeof event === "string" ? event : encodeEvent(event);
        // Split each line in two chunks, as a network might.
        controller.enqueue(encoder.encode(line.slice(0, 5)));
        controller.enqueue(encoder.encode(line.slice(5)));
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function run(response: Response | (() => Promise<Response>), body: ConvertBody = URL_BODY, timeoutMs?: number) {
  const fetchImpl = vi.fn(typeof response === "function" ? response : async () => response);
  const actions: ConversionAction[] = [];
  const final = await runConversion(body, (a) => actions.push(a), {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return { final, actions, fetchImpl };
}

describe("runConversion", () => {
  const overview = { summary: "Toast the oats, simmer, top with apples.", components: [] };

  it("asks for NDJSON and reduces every event as it arrives", async () => {
    const { final, actions, fetchImpl } = await run(
      ndjson([
        { type: "facts", facts: facts() },
        { type: "overview", overview },
        { type: "recipe", recipe: RECIPE, facts: facts({ title: RECIPE.title }) },
        { type: "procedure", timeline: TIMELINE },
        { type: "done", artifact: ARTIFACT, cached: false, warnings: ["Timings relabeled."] },
      ]),
    );
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/convert");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ accept: "application/x-ndjson", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual(URL_BODY);
    expect(actions.map((a) => a.type)).toEqual(["start", "facts", "overview", "recipe", "procedure", "done"]);
    expect(final).toMatchObject({ status: "done", notices: ["Timings relabeled."], overview });
    expect(final.timeline?.tasks).toHaveLength(6);
  });

  it("ends on an error event with the friendly copy", async () => {
    const { final } = await run(
      ndjson([{ type: "facts", facts: facts() }, { type: "error", status: 503, error: "took too long to convert" }]),
    );
    expect(final.status).toBe("failed");
    expect(final.error?.title).toBe("That took too long");
    expect(final.facts?.title).toBe("Blueberry Muffins");
  });

  it("says the connection dropped, and that a URL may still finish, when the stream stops early", async () => {
    const { final } = await run(ndjson([{ type: "facts", facts: facts() }]));
    expect(final.error?.title).toBe("Connection lost");
    expect(final.error?.detail).toMatch(/may still finish converting/);
    const text = await run(ndjson([]), { text: "Mix." });
    expect(text.final.error?.detail).toMatch(/Check your connection and try again/);
  });

  it("reads a cache hit answered as JSON, as before streaming", async () => {
    const { final } = await run(json({ artifact: ARTIFACT, cached: true, warnings: ["Note."] }));
    expect(final).toMatchObject({ status: "done", cached: true, notices: ["Note."] });
  });

  it("reads errors found before the stream starts from the JSON answer", async () => {
    const cap = await run(json({ error: "Daily conversion limit reached.", reason: "daily_cap" }, 429));
    expect(cap.final.error?.title).toBe("Today's free conversions are used up");
    expect(cap.final.error?.href).toBe(`/assistants?url=${encodeURIComponent(URL_BODY.url)}`);
    const https = await run(json({ error: "Only https URLs are accepted." }, 400));
    expect(https.final.error?.title).toBe("That address won't work");
    const notJson = await run(new Response("<html>", { status: 502, headers: { "content-type": "text/html" } }));
    expect(notJson.final.error?.title).toBe("The recipe service stumbled");
    const invalid = await run(json({ artifact: { id: "nope" }, cached: false }));
    expect(invalid.final.error?.detail).toBe(INVALID_ARTIFACT_MESSAGE);
  });

  it("says the connection dropped when fetch fails, and times out after the client wait", async () => {
    const dropped = await run(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(dropped.final.error?.title).toBe("Connection lost");
    expect(dropped.final.error?.detail).toMatch(/may still finish converting/);
    const slow = await run(
      () =>
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 50);
        }),
      URL_BODY,
      10,
    );
    expect(slow.final.error?.title).toBe("That took too long");
  });

  it("treats a garbled line as a dropped connection", async () => {
    const { final } = await run(ndjson([{ type: "facts", facts: facts() }, "not json\n"]));
    expect(final.status).toBe("failed");
    expect(final.error?.title).toBe("Connection lost");
  });

  it("stops quietly when the page lets go", async () => {
    const controller = new AbortController();
    const actions: ConversionAction[] = [];
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = runConversion(URL_BODY, (a) => actions.push(a), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    const final = await pending;
    expect(final.status).toBe("working");
    expect(actions.map((a) => a.type)).toEqual(["start"]);
  });
});
