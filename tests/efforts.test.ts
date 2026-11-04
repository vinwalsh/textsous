import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EFFORTS,
  EFFORT_STAGES,
  effortEnvName,
  effortFor,
  EFFORTS_HEADER,
  parseEffortOverrides,
  requestEffortOverrides,
} from "../src/lib/model/efforts";
import { callStructured, type StructuredChatClient } from "../src/lib/model/structured";
import { z } from "zod";
import { canonicalize, type RecordingFile } from "../src/lib/stages/canonicalize";
import { procedure, type ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { review } from "../src/lib/stages/review";
import { assignScaleRules } from "../src/lib/stages/scaling";
import { planDietary } from "../src/lib/stages/dietary";
import { planCuisine } from "../src/lib/stages/cuisine";
import { voice } from "../src/lib/stages/voice";
import { schedule } from "../src/lib/scheduler/schedule";

const ENV_KEYS = ["MODEL_API_KEY", "VERCEL_ENV", ...EFFORT_STAGES.map(effortEnvName)];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Records the effort each call sends, then fails the call (no reply needed). */
function recorder(seen: Array<string | undefined>): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params) => {
          seen.push(params.reasoning_effort);
          throw Object.assign(new Error("stop here"), { status: 400 });
        },
      },
    },
  };
}

const canonRecording = JSON.parse(
  readFileSync("eval/recordings/herby-white-bean-toast.json", "utf8"),
) as RecordingFile;
const procRecording = JSON.parse(
  readFileSync("eval/recordings/procedure-herby-white-bean-toast.json", "utf8"),
) as ProcedureRecordingFile;
const recipe = procRecording.recipe;
const timeline = JSON.parse(procRecording.response);
const ingredients = recipe.ingredients.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit }));
const steps = recipe.steps.map((s) => ({ id: s.id, text: s.text }));

/** One call per stage, each through the recorder; returns the effort each sent. */
async function effortsSent(efforts?: Parameters<typeof effortFor>[1]): Promise<Record<string, string | undefined>> {
  const sent: Record<string, string | undefined> = {};
  const run = async (stage: string, call: (client: StructuredChatClient) => Promise<unknown>) => {
    const seen: Array<string | undefined> = [];
    await call(recorder(seen)).catch(() => {});
    sent[stage] = seen[0];
  };
  await run("canonicalize", (client) => canonicalize(canonRecording.input, { client, efforts }));
  await run("procedure", (client) => procedure(recipe, { client, efforts }));
  await run("review", (client) =>
    review(
      { recipe, timeline, schedule: schedule(timeline), equipmentProfile: { burners: 4, oven: true } },
      { client, efforts },
    ),
  );
  await run("scaling", (client) =>
    assignScaleRules({ title: recipe.title, servings: 2, ingredients, steps }, { client, efforts }),
  );
  await run("dietary", (client) =>
    planDietary({ title: recipe.title, servings: 2, ingredients: ingredients.map((i) => ({ ...i, allergens: [] })), steps }, "vegan", {
      client,
      efforts,
    }),
  );
  await run("cuisine", (client) =>
    planCuisine({ title: recipe.title, servings: 2, method: "", ingredients, steps }, "Thai", { client, efforts }),
  );
  await run("voice", (client) => voice(timeline, { client, efforts }));
  return sent;
}

describe("reasoning effort per stage", () => {
  it("has fast code defaults", () => {
    expect(DEFAULT_EFFORTS).toEqual({
      overview: "minimal",
      canonicalize: "low",
      procedure: "minimal",
      review: "low",
      scaling: "minimal",
      dietary: "low",
      cuisine: "low",
      voice: "low",
      transcribe: "low",
    });
    for (const stage of EFFORT_STAGES) expect(effortFor(stage)).toBe(DEFAULT_EFFORTS[stage]);
  });

  it("reads REASONING_EFFORT_<STAGE>, ignores values the API does not take, and lets an override win", () => {
    expect(effortEnvName("procedure")).toBe("REASONING_EFFORT_PROCEDURE");
    process.env.REASONING_EFFORT_PROCEDURE = " Minimal ";
    process.env.REASONING_EFFORT_REVIEW = "turbo";
    process.env.REASONING_EFFORT_CANONICALIZE = "";
    expect(effortFor("procedure")).toBe("minimal");
    expect(effortFor("review")).toBe("low");
    expect(effortFor("canonicalize")).toBe("low");
    expect(effortFor("procedure", { procedure: "high" })).toBe("high");
    expect(effortFor("procedure", { review: "high" })).toBe("minimal");
  });

  it("parses the experiment header, skipping unknown stages and values", () => {
    expect(parseEffortOverrides("procedure=minimal, REVIEW=Low")).toEqual({ procedure: "minimal", review: "low" });
    expect(parseEffortOverrides("foo=low,procedure=fast,review,=low,voice=low=high,")).toEqual({});
    expect(parseEffortOverrides(null)).toEqual({});
  });

  it("honors the header only on Vercel preview deployments", () => {
    const headers = new Headers({ [EFFORTS_HEADER]: "procedure=minimal" });
    expect(requestEffortOverrides(headers, { VERCEL_ENV: "preview" })).toEqual({ procedure: "minimal" });
    expect(requestEffortOverrides(headers, { VERCEL_ENV: "production" })).toBeUndefined();
    expect(requestEffortOverrides(headers, { VERCEL_ENV: "development" })).toBeUndefined();
    expect(requestEffortOverrides(headers, {})).toBeUndefined();
    expect(requestEffortOverrides(new Headers(), { VERCEL_ENV: "preview" })).toBeUndefined();
    expect(requestEffortOverrides(new Headers({ [EFFORTS_HEADER]: "x=y" }), { VERCEL_ENV: "preview" })).toBeUndefined();
  });

  it("every model stage sends its effort; env and per-request overrides apply", async () => {
    expect(await effortsSent()).toEqual({
      canonicalize: "low",
      procedure: "minimal",
      review: "low",
      scaling: "minimal",
      dietary: "low",
      cuisine: "low",
      voice: "low",
    });
    process.env.REASONING_EFFORT_VOICE = "medium";
    const sent = await effortsSent({ procedure: "minimal", review: "high" });
    expect(sent).toMatchObject({ procedure: "minimal", review: "high", voice: "medium", canonicalize: "low" });
  });

  it("an explicit reasoningEffort wins over overrides and env", async () => {
    process.env.REASONING_EFFORT_PROCEDURE = "minimal";
    const seen: Array<string | undefined> = [];
    await procedure(recipe, { client: recorder(seen), reasoningEffort: "high", efforts: { procedure: "low" } }).catch(
      () => {},
    );
    expect(seen).toEqual(["high"]);
  });
});

describe("a provider that refuses the effort", () => {
  it("gets the call once more without reasoning_effort", async () => {
    const seen: Array<string | undefined> = [];
    const client: StructuredChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            seen.push(params.reasoning_effort);
            if (params.reasoning_effort !== undefined) {
              throw Object.assign(new Error("Unsupported value: 'reasoning_effort' does not support 'minimal'."), {
                status: 400,
              });
            }
            return {
              choices: [{ message: { content: '{"echo":"ok"}' }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
    const result = await callStructured(z.strictObject({ echo: z.string() }), [{ role: "user", content: "hi" }], {
      schemaName: "echo",
      client,
      reasoningEffort: "minimal",
    });
    expect(result.data.echo).toBe("ok");
    expect(seen).toEqual(["minimal", undefined]);
  });
});
