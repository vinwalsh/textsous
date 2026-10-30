import { beforeEach, describe, expect, it } from "vitest";
import { setCachedConversion, stageVersions } from "../src/lib/cache";
import { POST } from "../src/app/api/convert/route";

// NOTE: the dev fallbacks for rate limit and daily cap are module-global, so
// the cap test runs first while the counters are still zero. Later tests use
// distinct IPs and a high cap.

function req(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.MODEL_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.DAILY_CONVERSION_CAP = "1000";
});

function makeRecipe(): Record<string, unknown> {
  return {
    version: 1,
    id: "rcp-probe",
    title: "Probe Soup",
    source: {
      kind: "text",
      url: null,
      site: null,
      author: null,
      book: null,
      page: null,
      license: null,
    },
    cuisine: null,
    nativeServings: 2,
    servingsLarge: null,
    scalingNotes: null,
    ingredients: [
      {
        id: "ing-1",
        name: "stock",
        quantity: "2",
        unit: "cups",
        quantity4: null,
        scaleRule: null,
        cookQuantity: null,
        buyQuantity: null,
        allergens: [],
        allergenTraces: [],
        note: null,
      },
    ],
    steps: [{ id: "step-1", kind: "active", text: "Simmer the stock." }],
    equipment: [],
    sourceFingerprint: "sha256:probe",
  };
}

describe("POST /api/convert", () => {
  it("returns 429 once the lowered daily cap is exceeded", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    const first = await POST(req({ text: "Probe soup. Serves 2." }, "10.8.8.1"));
    expect(first.status).toBe(500); // no key: cap consumed, model never called
    const second = await POST(req({ text: "Probe soup. Serves 2." }, "10.8.8.1"));
    expect(second.status).toBe(429);
  });

  it("serves a cached URL conversion as the artifact with zero tokens", async () => {
    const url = "https://example.com/api-test-recipe";
    await setCachedConversion(url, {
      artifact: { id: "art-probe" } as never,
      schedule: { tasks: [], criticalPath: [], totalMinutes: 0 },
      cachedAt: new Date().toISOString(),
      versions: stageVersions(),
      checksPassed: true,
    });
    const res = await POST(req({ url }, "10.8.8.2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cached).toBe(true);
    expect(body.artifact).toEqual({ id: "art-probe" });
    expect(body).toHaveProperty("schedule");
    expect(body).not.toHaveProperty("usage");
  });

  it("rejects missing and ambiguous bodies with 400", async () => {
    expect((await POST(req({}, "10.8.8.3"))).status).toBe(400);
    expect((await POST(req({ url: "https://example.com/x", text: "y" }, "10.8.8.3"))).status).toBe(
      400,
    );
    expect((await POST(req({ url: "http://example.com/x" }, "10.8.8.3"))).status).toBe(400);
  });

  it("fails text conversions without a key before any model call", async () => {
    const res = await POST(req({ text: "Probe soup. Serves 2." }, "10.8.8.4"));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/model api key/i);
  });

  it("rejects invalid and ambiguous recipe bodies with 400", async () => {
    expect((await POST(req({ recipe: { title: "nope" } }, "10.8.8.5"))).status).toBe(400);
    expect(
      (await POST(req({ url: "https://example.com/x", recipe: makeRecipe() }, "10.8.8.5"))).status,
    ).toBe(400);
  });

  it("fails recipe conversions without a key before any model call", async () => {
    const res = await POST(req({ recipe: makeRecipe() }, "10.8.8.6"));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/model api key/i);
  });
});
