import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setCachedConversion, stageVersions } from "../src/lib/cache";
import {
  checkRateLimit,
  dailyCap,
  ratePerHour,
  reserveDailyUnit,
  resetMemoryLimits,
} from "../src/lib/limits";
import { POST as convert } from "../src/app/api/convert/route";
import { POST as adjust, maxDuration as adjustMax } from "../src/app/api/adjust/route";
import { POST as storeArtifact, maxDuration as artifactMax } from "../src/app/api/artifact/route";
import { maxDuration as convertMax } from "../src/app/api/convert/route";
import { maxDuration as photoMax } from "../src/app/api/photo/route";
import { maxDuration as artifactGetMax } from "../src/app/api/artifact/[id]/route";
import { runLive } from "../src/app/api/helpers";
import { API_TIMEOUT_MS } from "../src/app/request";
import {
  DeadlineError,
  markSpent,
  runWithModelBudget,
} from "../src/lib/model/budget";
import { callStructured, type StructuredChatClient } from "../src/lib/model/structured";

function jsonRequest(path: string, body: unknown, ip: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ENV_KEYS = [
  "MODEL_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "DAILY_CONVERSION_CAP",
  "RATE_LIMIT_PER_HOUR",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetMemoryLimits();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("limit configuration", () => {
  it("defaults to 300 per day and 20 per hour, env overrides both", () => {
    expect(dailyCap()).toBe(300);
    expect(ratePerHour()).toBe(20);
    process.env.DAILY_CONVERSION_CAP = "50";
    process.env.RATE_LIMIT_PER_HOUR = "5";
    expect(dailyCap()).toBe(50);
    expect(ratePerHour()).toBe(5);
    process.env.RATE_LIMIT_PER_HOUR = "nonsense";
    expect(ratePerHour()).toBe(20);
  });

  it("refused reservations take nothing; release gives one unit back once", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    const first = await reserveDailyUnit();
    expect(first.allowed).toBe(true);
    expect((await reserveDailyUnit()).reason).toBe("daily_cap");
    await first.release();
    await first.release();
    const again = await reserveDailyUnit();
    expect(again.allowed).toBe(true);
    expect((await reserveDailyUnit()).allowed).toBe(false);
  });
});

describe("cache hits are free", () => {
  it("serves a cached URL even when the IP is rate limited and the cap is used up", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    process.env.RATE_LIMIT_PER_HOUR = "1";
    const url = "https://example.com/limits-cached-recipe";
    await setCachedConversion(url, {
      artifact: { id: "art-cached" } as never,
      schedule: { tasks: [], criticalPath: [], totalMinutes: 0 },
      cachedAt: new Date().toISOString(),
      versions: stageVersions(),
      checksPassed: true,
    });
    await checkRateLimit("10.9.9.9");
    await reserveDailyUnit();
    for (let i = 0; i < 3; i += 1) {
      const res = await convert(jsonRequest("/api/convert", { url }, "10.9.9.9"));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { cached: boolean }).cached).toBe(true);
    }
  });
});

describe("429 bodies (contract C2)", () => {
  it("rate limit 429 carries reason rate_limited on convert and adjust", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    const first = await convert(jsonRequest("/api/convert", { text: "Soup. Serves 2." }, "10.7.0.1"));
    expect(first.status).toBe(500); // no key
    const second = await convert(jsonRequest("/api/convert", { text: "Soup. Serves 2." }, "10.7.0.1"));
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: string; reason: string };
    expect(body.reason).toBe("rate_limited");
    expect(body.error.length).toBeGreaterThan(10);
  });

  it("daily cap 429 carries reason daily_cap and mentions Daily", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    await reserveDailyUnit();
    const res = await convert(jsonRequest("/api/convert", { text: "Soup. Serves 2." }, "10.7.0.2"));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body).toEqual({ error: expect.stringMatching(/Daily/), reason: "daily_cap" });
  });

  it("invalid input never touches the limits", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    for (let i = 0; i < 3; i += 1) {
      const res = await convert(jsonRequest("/api/convert", { url: "notaurl" }, "10.7.0.3"));
      expect(res.status).toBe(400);
    }
    expect((await checkRateLimit("10.7.0.3")).allowed).toBe(true);
  });
});

describe("request size and durations", () => {
  const big = JSON.stringify({ text: "x".repeat(300 * 1024) });

  it("413s JSON bodies over 256 KB on convert, adjust and artifact", async () => {
    for (const [handler, path] of [
      [convert, "/api/convert"],
      [adjust, "/api/adjust"],
      [storeArtifact, "/api/artifact"],
    ] as const) {
      const res = await handler(jsonRequest(path, big, "10.6.0.1"));
      expect(res.status).toBe(413);
    }
  });

  it("exports maxDuration 300 on model routes and 30 on artifact routes", () => {
    expect([convertMax, adjustMax, photoMax]).toEqual([300, 300, 300]);
    expect([artifactMax, artifactGetMax]).toEqual([30, 30]);
  });

  it("the browser waits longer than the server's 300 s limit", () => {
    expect(API_TIMEOUT_MS).toBeGreaterThanOrEqual(305_000);
  });
});

describe("failure logging", () => {
  it("logs route, status and code for failures, redacted", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    await convert(jsonRequest("/api/convert", { url: "http://example.com/x" }, "10.5.0.1"));
    await convert(jsonRequest("/api/convert", { text: "Soup. Serves 2." }, "10.5.0.2"));
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "request_failed", route: "convert", status: 400 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "request_failed",
        route: "convert",
        status: 500,
        code: "no_model_key",
      }),
    );
    expect(lines.join("\n")).not.toContain("example.com");
  });
});

describe("runLive gives the unit back only when nothing was spent", () => {
  it("releases on an early failure and keeps the unit once tokens are spent", async () => {
    const release = vi.fn(async () => {});
    const reservation = { allowed: true, remaining: 1, release };
    await expect(runLive(reservation, async () => Promise.reject(new Error("early")))).rejects.toThrow(
      "early",
    );
    expect(release).toHaveBeenCalledTimes(1);
    const kept = vi.fn(async () => {});
    await expect(
      runLive({ allowed: true, remaining: 1, release: kept }, async () => {
        markSpent();
        throw new Error("late");
      }),
    ).rejects.toThrow("late");
    expect(kept).not.toHaveBeenCalled();
  });
});

describe("runLive deadline counts from the request start", () => {
  it("subtracts time already spent fetching the page", async () => {
    const { timeLeftMs } = await import("../src/lib/model/budget");
    const reservation = { allowed: true, remaining: 1, release: vi.fn(async () => {}) };
    const left = await runLive(reservation, async () => timeLeftMs(), Date.now() - 30_000);
    expect(left).toBeLessThanOrEqual(250_000);
    expect(left).toBeGreaterThan(240_000);
  });
});

describe("model call timeouts, deadline and length", () => {
  const schema = z.strictObject({ echo: z.string() });

  function client(
    replies: Array<{ content: string; finish_reason?: string }>,
    seen: Array<{ messages: unknown[]; options?: { timeout?: number } }>,
  ): StructuredChatClient {
    return {
      chat: {
        completions: {
          create: async (params, options) => {
            seen.push({ messages: [...params.messages], options });
            const next = replies.shift() ?? { content: "{}" };
            return {
              choices: [
                { message: { content: next.content }, finish_reason: next.finish_reason ?? "stop" },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
  }

  beforeEach(() => {
    process.env.MODEL_API_KEY = "test-key";
  });

  it("passes a per-call timeout of at most 200 s", async () => {
    const seen: Array<{ messages: unknown[]; options?: { timeout?: number } }> = [];
    await callStructured(schema, [{ role: "user", content: "hi" }], {
      schemaName: "echo",
      client: client([{ content: '{"echo":"ok"}' }], seen),
    });
    expect(seen[0].options?.timeout).toBe(200_000);
    const { result } = runWithModelBudget(
      () =>
        callStructured(schema, [{ role: "user", content: "hi" }], {
          schemaName: "echo",
          client: client([{ content: '{"echo":"ok"}' }], seen),
        }),
      { deadlineMs: 60_000 },
    );
    await result;
    expect(seen[1].options?.timeout).toBeLessThanOrEqual(60_000);
  });

  it("refuses to start a call past the deadline, before any tokens", async () => {
    const seen: Array<{ messages: unknown[]; options?: { timeout?: number } }> = [];
    const { budget, result } = runWithModelBudget(
      () =>
        callStructured(schema, [{ role: "user", content: "hi" }], {
          schemaName: "echo",
          client: client([{ content: '{"echo":"ok"}' }], seen),
        }),
      { deadlineMs: 5_000 },
    );
    await expect(result).rejects.toBeInstanceOf(DeadlineError);
    expect(seen).toHaveLength(0);
    expect(budget.spent).toBe(false);
  });

  it("drops a length-truncated reply and retries once asking for a concise one", async () => {
    const seen: Array<{ messages: unknown[]; options?: { timeout?: number } }> = [];
    const result = await callStructured(schema, [{ role: "user", content: "hi" }], {
      schemaName: "echo",
      client: client(
        [
          { content: '{"echo":"trunc', finish_reason: "length" },
          { content: '{"echo":"ok"}' },
        ],
        seen,
      ),
    });
    expect(result.data.echo).toBe("ok");
    expect(seen).toHaveLength(2);
    const retry = JSON.stringify(seen[1].messages);
    expect(retry).not.toContain("trunc");
    expect(retry).toMatch(/cut off at the length limit/);
  });

  it("fails clearly when the reply is cut off twice", async () => {
    const seen: Array<{ messages: unknown[]; options?: { timeout?: number } }> = [];
    await expect(
      callStructured(schema, [{ role: "user", content: "hi" }], {
        schemaName: "echo",
        client: client(
          [
            { content: '{"echo":"a', finish_reason: "length" },
            { content: '{"echo":"b', finish_reason: "length" },
          ],
          seen,
        ),
      }),
    ).rejects.toThrow(/cut off at the length limit twice/);
  });
});
