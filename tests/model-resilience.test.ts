import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
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

describe("a quick upstream hiccup (readiness-6)", () => {
  const upstream = (status: number) => APIError.generate(status, { error: { message: "upstream" } }, undefined, {});

  function call(script: Array<{ content: string } | Error>, calls: { count: number }) {
    return callStructured(schema, [{ role: "user", content: "hi" }], {
      schemaName: "echo",
      client: client(script, calls),
      retryDelayMs: 0,
    });
  }

  it.each([
    ["a 503", () => upstream(503)],
    ["a 429", () => upstream(429)],
    ["a dropped connection", () => new APIConnectionError({ message: undefined })],
  ])("retries %s once under a route deadline", async (_label, make) => {
    const calls = { count: 0 };
    const { result } = underDeadline(() => call([make(), { content: '{"echo":"ok"}' }], calls));
    const reply = await result;
    expect(reply.data.echo).toBe("ok");
    expect(reply.attempts).toBe(2);
    expect(calls.count).toBe(2);
  });

  it("retries only once, and never a client error", async () => {
    const twice = { count: 0 };
    const { result } = underDeadline(() => call([upstream(503), upstream(502)], twice));
    await expect(result).rejects.toMatchObject({ status: 502 });
    expect(twice.count).toBe(2);
    const bad = { count: 0 };
    const { result: refused } = underDeadline(() => call([upstream(401), { content: '{"echo":"ok"}' }], bad));
    await expect(refused).rejects.toMatchObject({ status: 401 });
    expect(bad.count).toBe(1);
  });

  it("does not retry when the deadline leaves no room for a second call", async () => {
    const calls = { count: 0 };
    const { result } = underDeadline(() => call([upstream(503), { content: '{"echo":"ok"}' }], calls), 16_000);
    await expect(result).rejects.toMatchObject({ status: 503 });
    expect(calls.count).toBe(1);
  });

  it("leaves retries to the SDK when there is no route deadline (CLI)", async () => {
    const calls = { count: 0 };
    await expect(call([upstream(503), { content: '{"echo":"ok"}' }], calls)).rejects.toMatchObject({ status: 503 });
    expect(calls.count).toBe(1);
  });
});
