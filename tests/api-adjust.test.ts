import { beforeEach, describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import { POST } from "../src/app/api/adjust/route";
import { resetMemoryLimits } from "../src/lib/limits";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-test",
    recipe: {
      title: "Test Soup",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "stock",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          allergens: [],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Add stock." }],
      allergens: [],
      originalMethod: "",
      methodLabel: "",
      methodNotice: "",
      credit: {
        kind: "text",
        site: null,
        author: null,
        url: null,
        book: null,
        page: null,
        license: null,
      },
    },
    timelineDefinition: {
      lanes: [{ id: "lane-a", label: "A", color: "red", kind: "component" }],
      tasks: [
        {
          id: "task-1",
          phase: "cook",
          label: "Cook",
          cardTitle: { action: "Cook", subject: "soup", context: "" },
          description: "Cook.",
          completionCue: "Done.",
          minutes: 5,
          range: null,
          timingBasis: "estimate",
          sourceQuote: null,
          attention: "hands-on",
          timerEnabledByDefault: false,
          laneIds: ["lane-a"],
          dependencies: [],
          sourceStepIds: ["step-1"],
          checkpoints: [],
          tip: null,
          equipmentEvent: null,
          scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
        },
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "task-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function req(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/adjust", {
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

describe("POST /api/adjust", () => {
  it("rejects invalid artifacts with 400", async () => {
    expect((await POST(req({ artifact: {} }, "10.7.7.1"))).status).toBe(400);
    expect((await POST(req({}, "10.7.7.1"))).status).toBe(400);
  });

  it("rejects invalid adjustments with 400 before any model call", async () => {
    const artifact = makeArtifact();
    expect(
      (await POST(req({ artifact, dietary: "keto" }, "10.7.7.2"))).status,
    ).toBe(400);
    expect(
      (await POST(req({ artifact, voice: "pirate" }, "10.7.7.2"))).status,
    ).toBe(400);
    expect(
      (await POST(req({ artifact, servings: 99 }, "10.7.7.2"))).status,
    ).toBe(400);
  });

  it("takes up to 36 servings and refuses 37 before any limit or model call", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    resetMemoryLimits();
    try {
      for (const servings of [37, 36.5, 0.25, 37]) {
        const res = await POST(req({ artifact: makeArtifact(), servings }, "10.7.7.4"));
        expect(res.status, String(servings)).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe(
          "Servings must be between 0.5 and 36.",
        );
      }
      // 36 passes validation and reaches the model step (no key here), and
      // it is the IP's first counted request: the refusals above used none.
      const ok = await POST(req({ artifact: makeArtifact(), servings: 36 }, "10.7.7.4"));
      expect(ok.status).toBe(500);
      expect(((await ok.json()) as { error: string }).error).toMatch(/model api key/i);
      expect((await POST(req({ artifact: makeArtifact(), servings: 36 }, "10.7.7.4"))).status).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_PER_HOUR;
      resetMemoryLimits();
    }
  });

  it("fails before any model call without a key", async () => {
    const res = await POST(req({ artifact: makeArtifact(), servings: 4 }, "10.7.7.3"));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/model api key/i);
  });
});
