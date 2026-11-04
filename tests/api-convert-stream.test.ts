import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { POST as convertPOST } from "../src/app/api/convert/route";
import { POST as adjustPOST } from "../src/app/api/adjust/route";
import { cacheKeyForUrl, getCachedConversion, setCachedConversion, stageVersions } from "../src/lib/cache";
import { readEvents, type ConvertEvent } from "../src/lib/convert-events";
import { reserveDailyUnit, resetMemoryLimits } from "../src/lib/limits";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { fixtureArtifact } from "./helpers/fixture-artifact";
import { eventStream } from "../src/app/api/helpers";

// POST /api/convert with Accept: application/x-ndjson. The model is replaced
// by canned replies keyed by schema name (the recorded charred corn salad,
// scripted judgments and overview) and the page fetch by a fixed extraction
// with a schema.org Recipe. No network.

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; effort?: string }>,
  review: "pass" as "pass" | "block" | "timeout",
}));

vi.mock("../src/lib/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/model")>();
  const { readFileSync: read } = await import("node:fs");
  const recording = (name: string) => (JSON.parse(read(`eval/recordings/${name}.json`, "utf8")) as { response: string }).response;
  const judged = (passed: (name: string) => boolean) =>
    JSON.stringify({
      checks: [
        "source_fidelity",
        "quantities",
        "dietary_conditions",
        "method_and_safety",
        "equipment_capacity",
        "source_relationships",
        "tips_and_voice",
      ].map((name) => ({ name, passed: passed(name), detail: passed(name) ? "ok" : "the lime amount changed" })),
    });
  return {
    ...actual,
    callStructured: async (
      schema: z.ZodTypeAny,
      messages: Array<{ content: unknown }>,
      opts: { schemaName: string; reasoningEffort?: string },
    ) => {
      state.calls.push({ name: opts.schemaName, effort: opts.reasoningEffort });
      let content: string;
      if (opts.schemaName === "recipe_overview_v1") {
        content = JSON.stringify({
          title: "Charred Corn and Lime Salad",
          servingsText: "Serves 4 as a side dish",
          ingredientCount: 5,
          totalMinutes: 15,
          allergens: [],
          summary: "You'll char the corn, then toss the kernels with lime, cilantro and salt.",
          components: [{ name: "Corn", how: "Brushed with olive oil and charred on a hot grill." }],
        });
      } else if (opts.schemaName === "canonical_recipe_v1") {
        await new Promise((resolve) => setTimeout(resolve, 15));
        content = recording("charred-corn-salad");
      } else if (opts.schemaName === "timeline_definition_v1") {
        content = recording("procedure-charred-corn-salad");
      } else if (opts.schemaName === "review_judgments_v1") {
        actual.markSpent();
        if (state.review === "timeout") throw new actual.ModelTimeoutError();
        content = judged((name) => state.review === "pass" || name !== "quantities");
      } else if (opts.schemaName === "scaling_rules_v1") {
        const { ingredients } = JSON.parse(String(messages[1].content)) as { ingredients: Array<{ id: string }> };
        content = JSON.stringify({
          rules: ingredients.map((i) => ({ ingredientId: i.id, rule: "linear", reason: "scales" })),
        });
      } else {
        throw new Error(`unexpected model call: ${opts.schemaName}`);
      }
      actual.markSpent();
      return {
        data: schema.parse(JSON.parse(content)),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "test",
        provider: "meta",
        fallbackUsed: false,
        attempts: 1,
        rawContent: content,
      };
    },
  };
});

vi.mock("../src/lib/intake/url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/intake/url")>();
  const ingredientLines = [
    "4 ears corn, shucked",
    "1 tablespoon olive oil",
    "1 lime, juiced",
    "1/4 cup chopped cilantro",
    "1/2 teaspoon kosher salt",
  ];
  const instructionLines = ["Brush the corn with the olive oil.", "Char on a hot grill.", "Toss and serve."];
  return {
    ...actual,
    fetchAndExtract: async (url: string) => ({
      sourceUrl: url,
      finalUrl: url,
      canonicalUrl: url,
      site: "TextSous Fixtures",
      author: "TextSous Kitchen",
      title: "Charred Corn and Lime Salad",
      hasJsonLd: true,
      ingredientLines,
      instructionLines,
      servingsRaw: "4",
      rawText: "",
      warnings: [],
      jsonLd: {
        name: "Charred Corn and Lime Salad",
        author: "TextSous Kitchen",
        recipeYield: "4 servings",
        prepTime: "PT5M",
        cookTime: "PT10M",
        recipeIngredient: ingredientLines,
        recipeInstructions: instructionLines,
      },
    }),
  };
});

const corn = JSON.parse(readFileSync("eval/recordings/charred-corn-salad.json", "utf8")) as { input: { rawText: string } };
const proc = JSON.parse(
  readFileSync("eval/recordings/procedure-charred-corn-salad.json", "utf8"),
) as ProcedureRecordingFile;

const NDJSON = "application/x-ndjson";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const usedUrls: string[] = [];

function freshUrl(name: string): string {
  const url = `https://example.com/stream-${name}-${RUN}`;
  usedUrls.push(url);
  return url;
}

function post(body: unknown, ip: string, headers: Record<string, string> = {}, path = "/api/convert"): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, accept: NDJSON, ...headers },
    body: JSON.stringify(body),
  });
}

async function events(res: Response): Promise<ConvertEvent[]> {
  const out: ConvertEvent[] = [];
  for await (const event of readEvents(res.body as ReadableStream<Uint8Array>)) out.push(event);
  return out;
}

const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DAILY_CONVERSION_CAP", "RATE_LIMIT_PER_HOUR", "VERCEL_ENV"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  resetMemoryLimits();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DAILY_CONVERSION_CAP = "1000";
  state.calls = [];
  state.review = "pass";
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await Promise.all(
    usedUrls.map((url) => rm(path.join(".cache/convert", `${cacheKeyForUrl(url)}.json`), { force: true })),
  );
});

describe("POST /api/convert as NDJSON events", () => {
  it("streams a live text conversion: facts, overview, recipe, procedure, done", async () => {
    const res = await convertPOST(post({ text: corn.input.rawText }, "10.60.0.1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["facts", "overview", "recipe", "procedure", "done"]);
    const done = all[4];
    expect(done).toMatchObject({ type: "done", cached: false, warnings: expect.any(Array) });
    expect(done.type === "done" && done.artifact.recipe.title).toBe("Charred Corn and Lime Salad");
    expect(state.calls).toEqual(
      expect.arrayContaining([
        { name: "recipe_overview_v1", effort: "minimal" },
        { name: "canonical_recipe_v1", effort: "low" },
        { name: "timeline_definition_v1", effort: "low" },
        { name: "review_judgments_v1", effort: "low" },
      ]),
    );
  });

  it("streams a URL conversion with the page's facts first and caches it, even after the reader leaves", async () => {
    const url = freshUrl("url");
    const res = await convertPOST(post({ url }, "10.60.0.2"));
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]) as ConvertEvent;
    expect(first).toMatchObject({
      type: "facts",
      facts: { servingsText: "4 servings", ingredientCount: 5, minutes: { prep: 5, cook: 10, total: 15 } },
    });
    // The reader goes away; the conversion still finishes and is cached.
    await reader.cancel();
    for (let i = 0; i < 50 && !(await getCachedConversion(url)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await getCachedConversion(url))?.artifact.recipe.title).toBe("Charred Corn and Lime Salad");

    // The next request is a cache hit: one done event, no model call.
    state.calls = [];
    const hit = await convertPOST(post({ url }, "10.60.0.2"));
    const hitEvents = await events(hit);
    expect(hitEvents.map((e) => e.type)).toEqual(["done"]);
    expect(hitEvents[0]).toMatchObject({ type: "done", cached: true, warnings: [] });
    expect(state.calls).toEqual([]);
  });

  it("streams a cache hit as a single done event with the review notes", async () => {
    const url = freshUrl("cached");
    const note = { check: "equipment_capacity", status: "failed", detail: "Two pans share one burner." } as const;
    await setCachedConversion(url, {
      artifact: { ...fixtureArtifact(), reviewNotes: [note] },
      schedule: { tasks: [], criticalPath: [], totalMinutes: 0 },
      cachedAt: new Date().toISOString(),
      versions: stageVersions(),
      checksPassed: true,
    });
    const all = await events(await convertPOST(post({ url }, "10.60.0.3")));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ type: "done", cached: true, warnings: [note.detail] });
  });

  it("streams the photo-confirm path from the recipe", async () => {
    const all = await events(await convertPOST(post({ recipe: proc.recipe }, "10.60.0.4")));
    expect(all.map((e) => e.type)).toEqual(["facts", "recipe", "overview", "procedure", "done"]);
    expect(state.calls.some((c) => c.name === "canonical_recipe_v1")).toBe(false);
  });

  it("ends with one error event carrying the JSON route's status after the stream starts", async () => {
    state.review = "block";
    const blocked = await events(await convertPOST(post({ recipe: proc.recipe }, "10.60.0.5")));
    expect(blocked.map((e) => e.type)).toEqual(["facts", "recipe", "overview", "procedure", "error"]);
    expect(blocked.at(-1)).toEqual({
      type: "error",
      status: 422,
      error: "compile blocked: quantities: the lime amount changed",
    });
    state.review = "timeout";
    const slow = await events(await convertPOST(post({ text: corn.input.rawText }, "10.60.0.5")));
    expect(slow.at(-1)).toMatchObject({ type: "error", status: 503, error: expect.stringMatching(/took too long/) });

    // JSON mode answers the same statuses.
    state.review = "block";
    const json = await convertPOST(post({ recipe: proc.recipe }, "10.60.0.6", { accept: "application/json" }));
    expect(json.status).toBe(422);
    expect(await json.json()).toEqual({ error: "compile blocked: quantities: the lime amount changed" });
  });

  it("keeps JSON answers for every failure before the stream starts", async () => {
    const cross = await convertPOST(post({ text: "Soup." }, "10.60.0.7", { "sec-fetch-site": "cross-site" }));
    expect(cross.status).toBe(403);
    expect(cross.headers.get("content-type")).toMatch(/application\/json/);
    expect((await convertPOST(post({}, "10.60.0.7"))).status).toBe(400);
    expect((await convertPOST(post({ url: "http://example.com/x" }, "10.60.0.7"))).status).toBe(400);
    expect((await convertPOST(post({ text: "x".repeat(70_000) }, "10.60.0.7"))).status).toBe(400);

    process.env.RATE_LIMIT_PER_HOUR = "1";
    const first = await convertPOST(post({ recipe: proc.recipe }, "10.60.0.8"));
    expect(first.status).toBe(200);
    expect((await events(first)).at(-1)?.type).toBe("done");
    const limited = await convertPOST(post({ recipe: proc.recipe }, "10.60.0.8"));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ reason: "rate_limited" });

    process.env.DAILY_CONVERSION_CAP = "1";
    resetMemoryLimits();
    await reserveDailyUnit();
    const capped = await convertPOST(post({ text: corn.input.rawText }, "10.60.0.9"));
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ reason: "daily_cap" });
  });

  it("answers JSON, unchanged and without an overview call, when the client does not ask for events", async () => {
    const res = await convertPOST(post({ text: corn.input.rawText }, "10.60.0.10", { accept: "*/*" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["artifact", "schedule", "cached", "warnings", "usage", "timings", "formatWarnings"]);
    expect(Object.keys(body.timings as object)).toEqual(["canonicalizeMs", "procedureMs", "reviewMs"]);
    expect(state.calls.map((c) => c.name)).not.toContain("recipe_overview_v1");
  });

  it("logs the efforts and per-stage timings of a live conversion", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await events(await convertPOST(post({ text: corn.input.rawText }, "10.60.0.11")));
    } finally {
      spy.mockRestore();
    }
    const log = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "convert");
    expect(log).toMatchObject({
      kind: "text",
      cached: false,
      stream: true,
      efforts: { overview: "minimal", canonicalize: "low", procedure: "low", review: "low" },
      timings: {
        canonicalizeMs: expect.any(Number),
        procedureMs: expect.any(Number),
        reviewMs: expect.any(Number),
        overviewMs: expect.any(Number),
      },
      overview: "ok",
    });
  });
});

describe("the x-textsous-efforts header", () => {
  it("overrides efforts on preview deployments only, for convert and adjust", async () => {
    const header = { "x-textsous-efforts": "procedure=minimal,scaling=low" };
    await convertPOST(post({ recipe: proc.recipe }, "10.61.0.1", { ...header, accept: "application/json" }));
    expect(state.calls.find((c) => c.name === "timeline_definition_v1")?.effort).toBe("low");
    await adjustPOST(post({ artifact: fixtureArtifact(), servings: 4 }, "10.61.0.1", header, "/api/adjust"));
    expect(state.calls.find((c) => c.name === "scaling_rules_v1")?.effort).toBe("minimal");

    process.env.VERCEL_ENV = "preview";
    state.calls = [];
    await convertPOST(post({ recipe: proc.recipe }, "10.61.0.2", { ...header, accept: "application/json" }));
    expect(state.calls.find((c) => c.name === "timeline_definition_v1")?.effort).toBe("minimal");
    expect(state.calls.find((c) => c.name === "review_judgments_v1")?.effort).toBe("low");
    const adjusted = await adjustPOST(post({ artifact: fixtureArtifact(), servings: 4 }, "10.61.0.2", header, "/api/adjust"));
    expect(adjusted.status).toBe(200);
    expect(state.calls.find((c) => c.name === "scaling_rules_v1")?.effort).toBe("low");
  });
});

describe("eventStream", () => {
  it("sends blank keep-alive lines while idle, which readers skip, and survives a reader that leaves", async () => {
    const res = eventStream(async (send) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      send({ type: "error", status: 503, error: "x" });
    }, 5);
    const text = await res.text();
    expect(text.startsWith("\n")).toBe(true);
    expect(text.trim()).toBe(JSON.stringify({ type: "error", status: 503, error: "x" }));

    let finished = false;
    const left = eventStream(async (send) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      send({ type: "error", status: 500, error: "late" });
      finished = true;
    });
    await (left.body as ReadableStream<Uint8Array>).cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(finished).toBe(true);
  });
});
