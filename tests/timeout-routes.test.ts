import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adjustPOST } from "../src/app/api/adjust/route";
import { POST as convertPOST } from "../src/app/api/convert/route";
import { friendlyError } from "../src/app/request";
import { resetMemoryLimits } from "../src/lib/limits";
import { fixtureArtifact } from "./helpers/fixture-artifact";

// Every model call times out (the SDK's per-call timeout), or the pipeline
// deadline stops the call before it starts.
const failure = vi.hoisted(() => ({ kind: "timeout" as "timeout" | "deadline" }));

vi.mock("../src/lib/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/model")>();
  return {
    ...actual,
    callStructured: async () => {
      if (failure.kind === "deadline") throw new actual.DeadlineError("procedure");
      actual.markSpent();
      throw new actual.ModelTimeoutError();
    },
  };
});

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.80.0.1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  failure.kind = "timeout";
  resetMemoryLimits();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.DAILY_CONVERSION_CAP = "100";
});

describe("a timed-out model step (readiness-2)", () => {
  it("answers 503 'took too long', never the page-fetch copy, for pasted text", async () => {
    const res = await convertPOST(post("/api/convert", { text: "Probe soup. Serves 2. Simmer 10 minutes." }));
    expect(res.status).toBe(503);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/took too long to convert/);
    const copy = friendlyError(res.status, error);
    expect(copy.title).toBe("That took too long");
    expect(copy.action).toBeUndefined();
    expect(copy.detail).not.toMatch(/recipe site|Paste the recipe text instead/);
  });

  it("answers 503 when the deadline stops a step (it used to read as a 400 'too long' text)", async () => {
    failure.kind = "deadline";
    const res = await convertPOST(post("/api/convert", { text: "Probe soup. Serves 2. Simmer 10 minutes." }));
    expect(res.status).toBe(503);
    expect(friendlyError(res.status, "").title).toBe("That took too long");
  });

  it("answers 503 for an adjustment too", async () => {
    const res = await adjustPOST(post("/api/adjust", { artifact: fixtureArtifact(), cuisine: "Thai" }));
    expect(res.status).toBe(503);
    expect(friendlyError(res.status, "").title).toBe("That took too long");
  });
});
