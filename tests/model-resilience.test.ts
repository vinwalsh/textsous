import { APIConnectionTimeoutError } from "openai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelTimeoutError, runWithModelBudget } from "../src/lib/model/budget";
import { callStructured, type StructuredChatClient } from "../src/lib/model/structured";

const schema = z.strictObject({ echo: z.string() });

/** A fake transport: each entry is a reply or an error to throw, in order. */
function client(script: Array<{ content: string } | Error>, calls: { count: number }): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          const next = script[Math.min(calls.count, script.length - 1)];
          calls.count += 1;
          if (next instanceof Error) throw next;
          return {
            choices: [{ message: { content: next.content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
}

function underDeadline<T>(fn: () => Promise<T>, deadlineMs = 280_000) {
  return runWithModelBudget(fn, { deadlineMs });
}

beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key";
});

describe("a model call that times out (readiness-2)", () => {
  it("becomes the friendly 'took too long' error and counts as spent", async () => {
    const calls = { count: 0 };
    const { budget, result } = underDeadline(() =>
      callStructured(schema, [{ role: "user", content: "hi" }], {
        schemaName: "echo",
        client: client([new APIConnectionTimeoutError()], calls),
      }),
    );
    await expect(result).rejects.toBeInstanceOf(ModelTimeoutError);
    await expect(result).rejects.toThrow(/took too long to convert/);
    expect(calls.count).toBe(1); // never retried: a second slow call would pass the deadline
    expect(budget.spent).toBe(true);
  });
});
