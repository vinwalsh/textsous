import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callStructured,
  type ChatTextMessage,
  type StructuredChatClient,
} from "../src/lib/model/structured";

const schema = z.strictObject({ echo: z.string() });

interface FakeCall {
  model: string;
  messages: ChatTextMessage[];
  temperature: number;
  response_format: { type: string };
  max_completion_tokens?: number;
}

interface FakeCompletion {
  choices: Array<{ message: { content: string | null } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function completion(content: string): FakeCompletion {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
}

class FakeTransport implements StructuredChatClient {
  calls: FakeCall[] = [];
  constructor(private handler: (call: FakeCall, n: number) => unknown) {}
  chat = {
    completions: {
      create: async (params: FakeCall): Promise<FakeCompletion> => {
        this.calls.push(params);
        return this.handler(params, this.calls.length) as FakeCompletion;
      },
    },
  };
}

const MESSAGES: ChatTextMessage[] = [{ role: "user", content: "hi" }];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    MODEL_ID: process.env.MODEL_ID,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
  };
  process.env.MODEL_API_KEY = "test-key";
  delete process.env.MODEL_ID;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("callStructured with a fake transport", () => {
  it("succeeds on the first try", async () => {
    const transport = new FakeTransport(() => completion('{"echo":"hi"}'));
    const result = await callStructured(schema, MESSAGES, {
      schemaName: "t",
      client: transport,
    });
    expect(result.data).toEqual({ echo: "hi" });
    expect(result.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(result.provider).toBe("meta");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].response_format.type).toBe("json_schema");
  });

  it("re-prompts with the validation errors, then succeeds", async () => {
    const transport = new FakeTransport((_call, n) =>
      completion(n === 1 ? '{"echo":42}' : '{"echo":"fixed"}'),
    );
    const result = await callStructured(schema, MESSAGES, {
      schemaName: "t",
      client: transport,
    });
    expect(result.data).toEqual({ echo: "fixed" });
    expect(result.attempts).toBe(2);
    expect(transport.calls).toHaveLength(2);
    const retryMessages = transport.calls[1].messages;
    expect(retryMessages).toHaveLength(3);
    const reprompt = retryMessages[2];
    expect(reprompt.role).toBe("user");
    expect(reprompt.content as string).toContain("failed validation");
    expect(reprompt.content as string).toContain("Errors:");
  });

  it("fails after 3 attempts", async () => {
    const transport = new FakeTransport(() => completion('{"echo":42}'));
    await expect(
      callStructured(schema, MESSAGES, { schemaName: "t", client: transport }),
    ).rejects.toThrow(/failed validation after 3 attempt/);
    expect(transport.calls).toHaveLength(3);
  });

  it("falls back to JSON mode when json_schema is rejected", async () => {
    const transport = new FakeTransport((call) => {
      if (call.response_format.type === "json_schema") {
        throw {
          status: 400,
          message: "Bad Request: response_format json_schema is not supported by this model",
        };
      }
      return completion('{"echo":"hi"}');
    });
    const result = await callStructured(schema, MESSAGES, {
      schemaName: "t",
      client: transport,
    });
    expect(result.data).toEqual({ echo: "hi" });
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(transport.calls.map((c) => c.response_format.type)).toEqual([
      "json_schema",
      "json_object",
    ]);
  });

  it("passes maxTokens as max_completion_tokens", async () => {
    const transport = new FakeTransport(() => completion('{"echo":"hi"}'));
    await callStructured(schema, MESSAGES, {
      schemaName: "t",
      client: transport,
      maxTokens: 24000,
    });
    expect(transport.calls[0].max_completion_tokens).toBe(24000);
  });

  it("refuses contributor models in production without calling the transport", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.MODEL_ID = "muse-spark-1.3-contributor";
    const transport = new FakeTransport(() => completion('{"echo":"hi"}'));
    await expect(
      callStructured(schema, MESSAGES, { schemaName: "t", client: transport }),
    ).rejects.toThrow(/contributor-tier/);
    expect(transport.calls).toHaveLength(0);
  });
});
