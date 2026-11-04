import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as formatGET } from "../src/app/api/skills/format/route";
import { POST as cookAlongPOST } from "../src/app/api/skills/cook-along/route";
import { POST as sourcePOST } from "../src/app/api/skills/source/route";
import { GET as artifactGET } from "../src/app/api/artifact/[id]/route";
import { CookAlongArtifactSchema } from "../src/lib/schema/artifact";
import { COOK_ALONG_EXAMPLE, CookAlongRequestSchema, prepareCookAlong } from "../src/lib/skills";
import { resetSkillsRateLimits } from "../src/lib/skills/http";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";

const SECRET = "test-skills-secret";
const ALLOWLIST =
  /^https:\/\/open\.textsous\.com\/api\/artifact\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?sig=[0-9a-f]{64}$/;

function post(route: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

beforeEach(() => {
  process.env.SKILLS_API_SECRET = SECRET;
  process.env.ARTIFACT_SIGNING_SECRET = "test-signing-secret";
  process.env.ARTIFACT_STORE_DIR = mkdtempSync(path.join(tmpdir(), "skills-artifacts-"));
  delete process.env.MODEL_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.VERCEL_ENV;
  resetSkillsRateLimits();
});

afterEach(() => {
  delete process.env.SKILLS_API_SECRET;
  delete process.env.DAILY_CONVERSION_CAP;
});

describe("GET /api/skills/format", () => {
  it("is public, cacheable and works without the secret", async () => {
    delete process.env.SKILLS_API_SECRET;
    const res = formatGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.skillsVersion).toBe(1);
    expect(body.formatVersion).toBe(1);
    expect(JSON.stringify(body.inputSchema)).not.toContain("$ref");
    expect(CookAlongRequestSchema.safeParse(body.example).success).toBe(true);
  });

  it("teaches every rule the contract lists", async () => {
    const { instructions } = (await formatGET().json()) as { instructions: string };
    for (const needle of [
      /transcribe it exactly/i,
      /confirm or\s+correct it \*\*before\*\* you save/i,
      /book title, author and page/i,
      /get_recipe_source/,
      /Keep\s+the credit/i,
      /Mise en place first/i,
      /One prep task per prep action named in the ingredient notes/i,
      /exact amount, unit and ingredient name/i,
      /never carry amounts, times or temperatures/i,
      /round count and the per-round\s+time/i,
      /Hands-on setup is split from unattended cooking/i,
      /"source" \*\*only\*\* when/,
      /exactly one\s+kitchen lane/i,
      /EU-14 slugs/,
      /Never invent/i,
      /No nutrition or health claims/i,
      /Fixing errors/,
      /quote_not_in_steps/,
    ]) {
      expect(instructions).toMatch(needle);
    }
  });
});

describe("the format example", () => {
  it("keeps the porridge fixture recording's ingredients and steps", () => {
    const recording = JSON.parse(
      readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
    ) as ProcedureRecordingFile;
    const ex = COOK_ALONG_EXAMPLE.recipe;
    expect(ex.title).toBe(recording.recipe.title);
    expect(ex.servings).toBe(recording.recipe.nativeServings);
    expect(ex.ingredients.map((i) => [i.id, i.name, i.quantity, i.unit, i.note ?? null, i.allergens])).toEqual(
      recording.recipe.ingredients.map((i) => [i.id, i.name, i.quantity, i.unit, i.note ?? null, i.allergens]),
    );
    expect(ex.steps.map((s) => [s.id, s.text])).toEqual(recording.recipe.steps.map((s) => [s.id, s.text]));
    for (const step of recording.recipe.steps) {
      expect(COOK_ALONG_EXAMPLE.source.text).toContain(step.text);
    }
  });

  it("runs end to end offline into a stored, signed, valid artifact", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    const res = await cookAlongPOST(post("/api/skills/cook-along", COOK_ALONG_EXAMPLE));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      artifactId: string;
      artifactUrl: string;
      viewUrl: string;
      expiresAt: string;
      summary: Record<string, unknown>;
      warnings: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.artifactUrl).toMatch(
      /^http:\/\/localhost\/api\/artifact\/[0-9a-f-]{36}\?sig=[0-9a-f]{64}$/,
    );
    expect(body.viewUrl).toBe(`http://localhost/?src=${encodeURIComponent(body.artifactUrl)}`);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(body.summary).toEqual({
      title: "Toasted Oat Porridge with Brown Butter Apples",
      servings: 2,
      totalMinutes: 15,
      handsOnMinutes: 15,
      taskCount: 7,
      allergens: ["gluten", "milk"],
    });
    expect(body.warnings).toEqual([]);

    const url = new URL(body.artifactUrl);
    const fetched = await artifactGET(new Request(body.artifactUrl), {
      params: Promise.resolve({ id: url.pathname.split("/").pop() as string }),
    });
    expect(fetched.status).toBe(200);
    const artifact = CookAlongArtifactSchema.parse(await fetched.json());
    expect(artifact.formatVersion).toBe(1);
    expect(artifact.recipe.credit).toMatchObject({ kind: "text", author: "TextSous Kitchen", url: null });
    const timers = artifact.timelineDefinition.tasks.filter((t) => t.timerEnabledByDefault).map((t) => t.id);
    expect(timers).toEqual(["task-toast-oats", "task-simmer-porridge", "task-cook-apples"]);
    expect(artifact.timelineDefinition.lanes.every((l) => /^#[0-9A-F]{6}$/i.test(l.color))).toBe(true);

    // The daily conversion cap (lowered to 1) is never consumed.
    const again = await cookAlongPOST(post("/api/skills/cook-along", COOK_ALONG_EXAMPLE));
    expect(again.status).toBe(200);
  });

  it("uses https://open.textsous.com on Vercel production, matching the import allowlist", async () => {
    process.env.VERCEL_ENV = "production";
    const body = (await (await cookAlongPOST(post("/api/skills/cook-along", COOK_ALONG_EXAMPLE))).json()) as {
      artifactUrl: string;
      viewUrl: string;
    };
    expect(body.artifactUrl).toMatch(ALLOWLIST);
    expect(body.viewUrl.startsWith("https://open.textsous.com/?src=https%3A%2F%2Fopen.textsous.com%2Fapi%2Fartifact%2F")).toBe(true);
  });

  it("honors PUBLIC_ORIGIN", async () => {
    process.env.PUBLIC_ORIGIN = "https://preview.example.dev/";
    const body = (await (await cookAlongPOST(post("/api/skills/cook-along", COOK_ALONG_EXAMPLE))).json()) as {
      artifactUrl: string;
    };
    expect(body.artifactUrl.startsWith("https://preview.example.dev/api/artifact/")).toBe(true);
  });

  it("records the model judgments as not run and still compiles", async () => {
    const result = await prepareCookAlong(COOK_ALONG_EXAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notRun = result.review.checks.filter((c) => c.notRun).map((c) => c.name);
    expect(notRun).toHaveLength(7);
    expect(result.review.checks.filter((c) => !c.notRun).every((c) => c.passed)).toBe(true);
    expect(result.review.passed).toBe(true);
    expect(result.review.usage.totalTokens).toBe(0);
  });
});

describe("defaults", () => {
  it("fills ids, card titles, colors, kinds and the serve task from a minimal body", async () => {
    const result = await prepareCookAlong({
      source: { kind: "text", text: "Toast\n1 slice bread\nToast the bread for 3 minutes." },
      recipe: {
        title: "Toast",
        servings: 1,
        ingredients: [{ name: "bread", quantity: 1, unit: "slice", allergens: ["Wheat"] }],
        steps: [{ text: "Toast the bread for 3 minutes." }],
      },
      timeline: {
        lanes: [
          { id: "lane-base", label: "Bread" },
          { id: "lane-kitchen", label: "Kitchen" },
        ],
        tasks: [
          {
            phase: "cook",
            label: "Toast bread",
            description: "Toast 1 slice bread.",
            completionCue: "Golden brown.",
            minutes: 3,
            timingBasis: "source",
            sourceQuote: "for 3 minutes",
            attention: "hands-on",
            laneIds: ["lane-base"],
            sourceStepIds: ["step-1"],
            ingredientIds: ["ing-1"],
          },
          {
            phase: "finish",
            label: "Serve toast",
            description: "Serve the toast.",
            completionCue: "On the plate.",
            minutes: 1,
            timingBasis: "estimate",
            attention: "hands-on",
            laneIds: ["lane-kitchen"],
            dependencies: ["task-toast-bread"],
            sourceStepIds: ["step-1"],
          },
        ],
      },
      extra: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tl = result.artifact.timelineDefinition;
    expect(tl.tasks.map((t) => t.id)).toEqual(["task-toast-bread", "task-serve-toast"]);
    expect(tl.serveTaskId).toBe("task-serve-toast");
    expect(tl.tasks[0].cardTitle).toEqual({ action: "Toast", subject: "bread", context: "" });
    expect(tl.tasks[0].timerEnabledByDefault).toBe(true);
    expect(tl.tasks[1].timerEnabledByDefault).toBe(false);
    expect(tl.lanes.map((l) => l.kind)).toEqual(["component", "kitchen"]);
    expect(result.artifact.recipe.ingredients[0]).toMatchObject({ id: "ing-1", quantity: "1", allergens: ["gluten"] });
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["unknown_field", "allergen_mapped"]));
  });
});

describe("actionable errors", () => {
  async function errorsFor(mutate: (body: ReturnType<typeof clone<typeof COOK_ALONG_EXAMPLE>>) => void) {
    const body = clone(COOK_ALONG_EXAMPLE);
    mutate(body);
    const res = await cookAlongPOST(post("/api/skills/cook-along", body));
    expect(res.status).toBe(422);
    const json = (await res.json()) as { ok: boolean; errors: Array<{ path: string; code: string; message: string }> };
    expect(json.ok).toBe(false);
    expect(json.errors.length).toBeGreaterThan(0);
    for (const e of json.errors) expect(e.message.length).toBeGreaterThan(20);
    return json.errors;
  }

  it("points at an unknown step id", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.tasks[3].sourceStepIds = ["step-9"];
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.tasks[3].sourceStepIds[0]", code: "unknown_reference" }));
    expect(errors[0].message).toMatch(/step-1, step-2/);
  });

  it("points at a missing required field", async () => {
    const errors = await errorsFor((b) => {
      delete (b.timeline.tasks[2] as Partial<(typeof b.timeline.tasks)[number]>).completionCue;
    });
    expect(errors).toEqual([expect.objectContaining({ path: "timeline.tasks[2].completionCue", code: "invalid_value" })]);
    expect(errors[0].message).toMatch(/Add timeline\.tasks\[2\]\.completionCue/);
  });

  it("rejects a quote that is not in the steps or the source", async () => {
    const steps = await errorsFor((b) => {
      b.timeline.tasks[1].sourceQuote = "toast 3 minutes";
    });
    expect(steps).toContainEqual(expect.objectContaining({ path: "timeline.tasks[1].sourceQuote", code: "quote_not_in_steps" }));
    const source = await errorsFor((b) => {
      b.recipe.steps[0].text = "Toast the rolled oats for 4 minutes.";
      b.timeline.tasks[1].sourceQuote = "for 4 minutes";
    });
    expect(source).toContainEqual(expect.objectContaining({ path: "timeline.tasks[1].sourceQuote", code: "quote_not_in_source" }));
  });

  it("requires a quote for a source timing", async () => {
    const errors = await errorsFor((b) => {
      delete b.timeline.tasks[1].sourceQuote;
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.tasks[1].sourceQuote", code: "quote_missing" }));
  });

  it("requires the kitchen lane last", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.lanes.reverse();
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.lanes", code: "lanes" }));
  });

  it("flags an ingredient no task uses", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.tasks[5].ingredientIds = ["ing-4", "ing-5"];
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "recipe.ingredients[5]", code: "unused_ingredient" }));
  });

  it("finds dependency cycles and prep tasks waiting for cook tasks", async () => {
    const cycle = await errorsFor((b) => {
      b.timeline.tasks[1].dependencies = ["task-add-milk"];
    });
    expect(cycle).toContainEqual(expect.objectContaining({ code: "dependency_cycle" }));
    const prep = await errorsFor((b) => {
      b.timeline.tasks[0].dependencies = ["task-toast-oats"];
    });
    expect(prep).toContainEqual(expect.objectContaining({ path: "timeline.tasks[0].dependencies[0]", code: "prep_depends_on_cook" }));
  });

  it("keeps numbers out of card titles", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.tasks[3].cardTitle = { action: "Simmer", subject: "porridge", context: "6 minutes" };
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.tasks[3].cardTitle", code: "numbers_in_card_title" }));
  });

  it("names the EU-14 slugs for an unknown allergen", async () => {
    const errors = await errorsFor((b) => {
      b.recipe.ingredients[0].allergens = ["oats"];
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "recipe.ingredients[0].allergens[0]" }));
    expect(errors[0].message).toMatch(/celery, gluten/);
  });

  it("requires source text for pasted text and photos", async () => {
    const errors = await errorsFor((b) => {
      b.source = { kind: "photo", book: "Our Kitchen", page: 12 };
    });
    expect(errors).toEqual([expect.objectContaining({ path: "source.text", code: "missing_source_text" })]);
  });

  it("asks for checkpoints on a long hands-on task", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.tasks[0].minutes = 20;
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.tasks[0].checkpoints", code: "needs_checkpoints" }));
  });

  it("rejects minutes over 180 with a split hint", async () => {
    const errors = await errorsFor((b) => {
      b.timeline.tasks[3].minutes = 240;
    });
    expect(errors).toContainEqual(expect.objectContaining({ path: "timeline.tasks[3].minutes" }));
    expect(errors.find((e) => e.path === "timeline.tasks[3].minutes")?.message).toMatch(/split/);
  });

  it("rejects a body that is not the right shape", async () => {
    const res = await cookAlongPOST(post("/api/skills/cook-along", { recipe: {} }));
    expect(res.status).toBe(422);
    const json = (await res.json()) as { errors: Array<{ path: string }> };
    expect(json.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["source", "recipe.title", "timeline"]));
  });
});

describe("auth, size and rate limits", () => {
  it("returns 503 not_configured on both secret routes when the secret is unset", async () => {
    delete process.env.SKILLS_API_SECRET;
    for (const [handler, route] of [
      [cookAlongPOST, "/api/skills/cook-along"],
      [sourcePOST, "/api/skills/source"],
    ] as const) {
      const res = await handler(post(route, COOK_ALONG_EXAMPLE));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: { code: "not_configured", message: expect.any(String) } });
    }
  });

  it("returns 401 for a missing or wrong bearer", async () => {
    for (const authorization of ["", "Bearer nope", `Basic ${SECRET}`, `Bearer ${SECRET}x`]) {
      for (const [handler, route] of [
        [cookAlongPOST, "/api/skills/cook-along"],
        [sourcePOST, "/api/skills/source"],
      ] as const) {
        const res = await handler(post(route, COOK_ALONG_EXAMPLE, { authorization }));
        expect(res.status).toBe(401);
        const json = (await res.json()) as { ok: boolean; error: { code: string } };
        expect(json).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      }
    }
  });

  it("returns 413 too_large over 256 KB, by header or by stream", async () => {
    const big = clone(COOK_ALONG_EXAMPLE);
    big.source.text = "x".repeat(300 * 1024);
    const res = await cookAlongPOST(post("/api/skills/cook-along", big));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "too_large" } });
    const streamed = new Request("http://localhost/api/skills/source", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 5; i += 1) controller.enqueue(new Uint8Array(64 * 1024));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect((await sourcePOST(streamed)).status).toBe(413);
  });

  it("limits one account to 60 requests an hour", async () => {
    const headers = { "x-textsous-account": "acct-hash-1" };
    for (let i = 0; i < 60; i += 1) {
      const res = await sourcePOST(post("/api/skills/source", { nope: true }, headers));
      expect(res.status).toBe(422);
    }
    const limited = await sourcePOST(post("/api/skills/source", { nope: true }, headers));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    const other = await sourcePOST(post("/api/skills/source", { nope: true }, { "x-textsous-account": "acct-hash-2" }));
    expect(other.status).toBe(422);
  });
});
