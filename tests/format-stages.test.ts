import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StructuredChatClient } from "../src/lib/model/structured";
import {
  canonicalize,
  CANONICALIZE_REASONING_EFFORT,
  CANONICALIZE_VERSION,
  type RecordingFile,
} from "../src/lib/stages/canonicalize";
import { procedure, PROCEDURE_VERSION, type ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { review, REVIEW_VERSION } from "../src/lib/stages/review";
import { COMPILE_VERSION } from "../src/lib/stages/compile";
import { schedule } from "../src/lib/scheduler/schedule";

interface Call {
  messages: Array<{ role: string; content: unknown }>;
  reasoning_effort?: string;
}

function fake(content: string, calls: Call[] = []): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params: Call) => {
          calls.push(params);
          return {
            choices: [{ message: { content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };
        },
      },
    },
  } as unknown as StructuredChatClient;
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = saved;
});

describe("stage versions", () => {
  it("are bumped for the output-format rules (new cache keys)", () => {
    expect(CANONICALIZE_VERSION).toBeGreaterThanOrEqual(2);
    expect(PROCEDURE_VERSION).toBeGreaterThanOrEqual(2);
    expect(COMPILE_VERSION).toBeGreaterThanOrEqual(2);
    expect(REVIEW_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe("canonicalize output format", () => {
  it("cleans the title after the model and sends reasoning_effort only when set", async () => {
    const recording = JSON.parse(
      readFileSync("eval/recordings/herby-white-bean-toast.json", "utf8"),
    ) as RecordingFile;
    const response = JSON.parse(recording.response);
    response.title = "Easy! Herby White Bean Toast Recipe 🍞";
    const calls: Call[] = [];
    const result = await canonicalize(recording.input, { client: fake(JSON.stringify(response), calls) });
    expect(result.recipe.title).toBe("Herby White Bean Toast");
    expect(calls[0].reasoning_effort).toBe(CANONICALIZE_REASONING_EFFORT);

    const lowCalls: Call[] = [];
    await canonicalize(recording.input, {
      client: fake(JSON.stringify(response), lowCalls),
      reasoningEffort: "low",
    });
    expect(lowCalls[0].reasoning_effort).toBe("low");
  });
});

describe("procedure output format", () => {
  it("sends ingredient notes to the model and polishes the timeline", async () => {
    const recording = JSON.parse(
      readFileSync("eval/recordings/procedure-herby-white-bean-toast.json", "utf8"),
    ) as ProcedureRecordingFile;
    const response = JSON.parse(recording.response);
    response.tasks[0].cardTitle.context = "for 5 minutes";
    response.tasks[0].why = "Mashing half keeps texture. The rest stays whole.";
    const calls: Call[] = [];
    const result = await procedure(recording.recipe, { client: fake(JSON.stringify(response), calls) });
    const user = JSON.parse(String(calls[0].messages[1].content));
    expect(user.ingredients[0].note).toBe("drained and rinsed");
    expect(calls[0].reasoning_effort).toBeUndefined();
    expect(result.timeline.tasks[0].cardTitle.context).toBe("");
    expect(result.timeline.tasks[0].why).toBe("Mashing half keeps texture.");
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.repairs).toEqual([]);
  });
});

describe("review format warnings", () => {
  it("returns coded warnings without blocking", async () => {
    const recording = JSON.parse(
      readFileSync("eval/recordings/procedure-herby-white-bean-toast.json", "utf8"),
    ) as ProcedureRecordingFile;
    const timeline = JSON.parse(recording.response);
    const judgments = {
      checks: [
        "source_fidelity",
        "quantities",
        "dietary_conditions",
        "method_and_safety",
        "equipment_capacity",
        "source_relationships",
        "tips_and_voice",
      ].map((name) => ({ name, passed: true, detail: "ok" })),
    };
    const result = await review(
      {
        recipe: recording.recipe,
        timeline,
        schedule: schedule(timeline),
        equipmentProfile: { burners: 4, oven: true },
      },
      { client: fake(JSON.stringify(judgments)) },
    );
    expect(result.passed).toBe(true);
    expect(result.warnings?.some((w) => w.code === "amount_missing")).toBe(true);
  });
});

describe("model call options under a deadline", () => {
  it("never lets the SDK retry when a second attempt would not fit", async () => {
    const { callOptions } = await import("../src/lib/model/structured");
    expect(callOptions(Number.POSITIVE_INFINITY)).toEqual({ timeout: 200_000, maxRetries: 1 });
    expect(callOptions(270_000)).toEqual({ timeout: 200_000, maxRetries: 0 });
    expect(callOptions(90_000)).toEqual({ timeout: 90_000, maxRetries: 0 });
  });
});
