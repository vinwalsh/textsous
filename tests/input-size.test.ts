import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as adjustPOST } from "../src/app/api/adjust/route";
import { POST as convertPOST } from "../src/app/api/convert/route";
import { reserveDailyUnit, resetMemoryLimits } from "../src/lib/limits";
import { CookAlongArtifactSchema } from "../src/lib/schema/artifact";
import { CanonicalRecipeSchema } from "../src/lib/schema/canonical";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { fixtureArtifact } from "./helpers/fixture-artifact";

// security-4: the daily cap counts requests, not tokens. A schema-valid but
// padded artifact or recipe would carry 15-50 times a real recipe's input
// into the model for one unit, so oversized inputs are refused first.

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.70.0.1" },
    body: JSON.stringify(body),
  });
}

const recipe = (
  JSON.parse(readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8")) as ProcedureRecordingFile
).recipe;

beforeEach(() => {
  resetMemoryLimits();
  delete process.env.MODEL_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.DAILY_CONVERSION_CAP = "1";
});

describe("input sizes for one daily unit", () => {
  it("refuses an adjust artifact over 64 KB before any daily unit", async () => {
    const artifact = fixtureArtifact();
    const padded = {
      ...artifact,
      changes: [...artifact.changes, { kind: "technique" as const, detail: "x".repeat(70_000) }],
    };
    expect(CookAlongArtifactSchema.safeParse(padded).success).toBe(true);
    const res = await adjustPOST(post("/api/adjust", { artifact: padded, voice: "sous" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/too large to adjust/);
    expect((await reserveDailyUnit()).allowed).toBe(true);
  });

  it("refuses a cuisine target longer than 80 characters", async () => {
    const res = await adjustPOST(post("/api/adjust", { artifact: fixtureArtifact(), cuisine: "Italian ".repeat(20) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Cuisine style is too long/);
  });

  it("still adjusts a real-sized artifact", async () => {
    const res = await adjustPOST(post("/api/adjust", { artifact: fixtureArtifact(), cuisine: "Italian" }));
    expect(res.status).toBe(500); // reached the model stage; no key in tests
  });

  it("refuses a confirmed recipe over 60,000 characters before any daily unit", async () => {
    const padded = { ...recipe, steps: [...recipe.steps, { id: "step-pad", kind: "active", text: "y".repeat(61_000) }] };
    expect(CanonicalRecipeSchema.safeParse(padded).success).toBe(true);
    const res = await convertPOST(post("/api/convert", { recipe: padded }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Recipe is too long/);
    const unit = await reserveDailyUnit();
    expect(unit.allowed).toBe(true);
    await unit.release();
    const real = await convertPOST(post("/api/convert", { recipe }));
    expect(real.status).toBe(500); // reached the model stage
  });
});
