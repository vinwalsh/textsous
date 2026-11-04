import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { setCachedConversion, stageVersions } from "../src/lib/cache";
import { POST as convertPOST } from "../src/app/api/convert/route";
import { POST as adjustPOST } from "../src/app/api/adjust/route";
import { friendlyError } from "../src/app/request";
import { buildReviewNote, mergeNotes, readableReviewDetail, reviewNoteTexts } from "../src/lib/review-notes";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "../src/lib/schema/artifact";
import { compile } from "../src/lib/stages/compile";
import { applyScaling } from "../src/lib/stages/scaling";
import type { ProcedureRecordingFile } from "../src/lib/stages/procedure";
import { resetMemoryLimits } from "../src/lib/limits";
import { fixtureArtifact } from "./helpers/fixture-artifact";

// D1: equipment_capacity, source_relationships and tips_and_voice are
// advisory. The model is replaced by canned replies keyed by schema name: the
// recorded porridge timeline, a scripted review and scale rules. No network.
const replies = vi.hoisted(() => ({
  judgments: [] as Array<{ name: string; passed: boolean; detail: string }>,
  scaleRules: [] as Array<{ ingredientId: string; rule: string; reason: string }>,
}));

vi.mock("../src/lib/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/model")>();
  const { readFileSync: read } = await import("node:fs");
  return {
    ...actual,
    callStructured: async (schema: z.ZodTypeAny, _messages: unknown, opts: { schemaName: string }) => {
      let content: string;
      if (opts.schemaName === "timeline_definition_v1") {
        content = (JSON.parse(read("eval/recordings/procedure-toasted-oat-porridge.json", "utf8")) as {
          response: string;
        }).response;
      } else if (opts.schemaName === "review_judgments_v1") {
        content = JSON.stringify({ checks: replies.judgments });
      } else if (opts.schemaName === "scaling_rules_v1") {
        content = JSON.stringify({ rules: replies.scaleRules });
      } else {
        throw new Error(`unexpected model call: ${opts.schemaName}`);
      }
      return {
        data: schema.parse(JSON.parse(content)),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "test",
        provider: "meta",
        fallbackUsed: false,
        attempts: 1,
        rawContent: content,
      };
    },
  };
});

const JUDGED = [
  "source_fidelity",
  "quantities",
  "dietary_conditions",
  "method_and_safety",
  "equipment_capacity",
  "source_relationships",
  "tips_and_voice",
] as const;

function judgments(overrides: Record<string, { passed: boolean; detail: string } | null>) {
  return JUDGED.flatMap((name) => {
    const o = overrides[name];
    if (o === null) return [];
    return [{ name, passed: o?.passed ?? true, detail: o?.detail ?? "looks good" }];
  });
}

const recording = JSON.parse(
  readFileSync("eval/recordings/procedure-toasted-oat-porridge.json", "utf8"),
) as ProcedureRecordingFile;

function req(path: string, body: unknown, ip: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetMemoryLimits();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.DAILY_CONVERSION_CAP = "1000";
  replies.judgments = judgments({});
  replies.scaleRules = recording.recipe.ingredients.map((i) => ({
    ingredientId: i.id,
    rule: "linear",
    reason: "scales with servings",
  }));
});

describe("readable review notes", () => {
  it("names tasks, lanes, steps and ingredients instead of ids", () => {
    const timeline = JSON.parse(recording.response) as CookAlongArtifact["timelineDefinition"];
    const text = readableReviewDetail(
      "task-toast-oats is forced to wait for task-cook-apples in lane-garnish (step-2, ing-3)",
      recording.recipe,
      timeline,
    );
    expect(text).toBe(
      '"Toast oats" is forced to wait for "Cook apples" in Brown Butter Apples (step 2, unsalted butter)',
    );
  });

  it("reads as calm sentences for a failed and a skipped check", () => {
    expect(buildReviewNote("source_relationships", "failed", "toasting waits for mashing").detail).toBe(
      "The automatic review flagged the order of the steps: toasting waits for mashing. Compare with the original recipe if something looks off.",
    );
    expect(buildReviewNote("tips_and_voice", "not_judged", "the model did not judge this check").detail).toBe(
      "The automatic review did not check the tips and done-when cues for this recipe.",
    );
  });

  it("merges note lists without repeats and tolerates older artifacts", () => {
    expect(mergeNotes(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(reviewNoteTexts({})).toEqual([]);
    expect(reviewNoteTexts(null)).toEqual([]);
    expect(reviewNoteTexts({ id: "art-probe" } as never)).toEqual([]);
  });
});

describe("compile records advisory notes (C1: optional, additive)", () => {
  const base = fixtureArtifact();
  const note = buildReviewNote("source_relationships", "failed", "toasting waits for mashing");

  it("adds reviewNotes only when the review raised some", () => {
    const compileWith = (advisories: Array<typeof note>) =>
      compile({
        recipe: recording.recipe,
        timeline: JSON.parse(recording.response),
        review: {
          checks: [],
          passed: true,
          blockers: [],
          advisories,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          fallbackUsed: false,
          attempts: 1,
          rawResponse: "",
        },
        equipmentProfile: { burners: 4, oven: true },
      });
    const plain = compileWith([]);
    const withNotes = compileWith([note]);
    expect("reviewNotes" in plain).toBe(false);
    expect("reviewNotes" in base).toBe(false);
    expect(withNotes.reviewNotes).toEqual([note]);
    expect(withNotes.formatVersion).toBe(1);
    // Notes never change the recipe, the timeline or the artifact id.
    const rest: Partial<CookAlongArtifact> = { ...withNotes };
    delete rest.reviewNotes;
    expect(rest).toEqual(plain);
    expect(CookAlongArtifactSchema.safeParse(withNotes).success).toBe(true);
    expect(CookAlongArtifactSchema.safeParse(plain).success).toBe(true);
  });

  it("keeps the notes through an adjustment", () => {
    const artifact = { ...base, reviewNotes: [note] };
    const scaled = applyScaling(
      artifact,
      4,
      recording.recipe.ingredients.map((i) => ({ ingredientId: i.id, rule: "linear" as const, reason: "x" })),
    );
    expect(scaled.artifact.reviewNotes).toEqual([note]);
  });
});

describe("routes: advisory failures convert, blocking failures do not", () => {
  it("converts despite a failed source_relationships and a missing tips_and_voice judgment", async () => {
    replies.judgments = judgments({
      source_relationships: { passed: false, detail: "task-toast-oats is forced to wait for task-cook-apples" },
      tips_and_voice: null,
    });
    const res = await convertPOST(req("/api/convert", { recipe: recording.recipe }, "10.40.0.1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: CookAlongArtifact; warnings: string[] };
    expect(body.artifact.reviewNotes?.map((n) => [n.check, n.status])).toEqual([
      ["source_relationships", "failed"],
      ["tips_and_voice", "not_judged"],
    ]);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        'The automatic review flagged the order of the steps: "Toast oats" is forced to wait for "Cook apples". Compare with the original recipe if something looks off.',
        "The automatic review did not check the tips and done-when cues for this recipe.",
      ]),
    );
    expect(body.warnings.join(" ")).not.toMatch(/task-|source_relationships|tips_and_voice/);
    expect(CookAlongArtifactSchema.safeParse(body.artifact).success).toBe(true);
  });

  it("still refuses a failed or missing fidelity or safety judgment", async () => {
    replies.judgments = judgments({ quantities: { passed: false, detail: "the milk amount changed" } });
    const failed = await convertPOST(req("/api/convert", { recipe: recording.recipe }, "10.40.0.2"));
    expect(failed.status).toBe(422);
    expect(((await failed.json()) as { error: string }).error).toBe(
      "compile blocked: quantities: the milk amount changed",
    );
    replies.judgments = judgments({ source_fidelity: null });
    const missing = await convertPOST(req("/api/convert", { recipe: recording.recipe }, "10.40.0.2"));
    expect(missing.status).toBe(422);
  });

  it("answers 422 with the calm copy whatever words the blocking reason uses", async () => {
    // A model-written reason with "too long" or "credentials" used to match
    // the 400 patterns for pasted text and URLs first (fix-pass review).
    const reasons = {
      method_and_safety: "The cooked porridge is held at room temperature too long before serving.",
      source_fidelity: "the step about credentials is invented",
    };
    for (const [check, detail] of Object.entries(reasons)) {
      replies.judgments = judgments({ [check]: { passed: false, detail } });
      const res = await convertPOST(req("/api/convert", { recipe: recording.recipe }, "10.40.0.5"));
      expect(res.status).toBe(422);
      const { error } = (await res.json()) as { error: string };
      expect(error).toBe(`compile blocked: ${check}: ${detail}`);
      const copy = friendlyError(res.status, error);
      expect(copy.title).toBe("We couldn't double-check this one");
      expect(copy.more).toBe(`${check}: ${detail}`);
    }
  });

  it("returns the artifact's notes as warnings on a cache hit", async () => {
    const note = buildReviewNote("equipment_capacity", "failed", "two pans on one burner");
    const url = "https://example.com/advisory-cached-recipe";
    await setCachedConversion(url, {
      artifact: { ...fixtureArtifact(), reviewNotes: [note] },
      schedule: { tasks: [], criticalPath: [], totalMinutes: 0 },
      cachedAt: new Date().toISOString(),
      versions: stageVersions(),
      checksPassed: false,
    });
    const res = await convertPOST(req("/api/convert", { url }, "10.40.0.3"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { warnings: string[] }).warnings).toEqual([note.detail]);
  });

  it("returns the notes in the adjust response and keeps them on the artifact", async () => {
    const note = buildReviewNote("source_relationships", "failed", "toasting waits for mashing");
    const res = await adjustPOST(
      req("/api/adjust", { artifact: { ...fixtureArtifact(), reviewNotes: [note] }, servings: 4 }, "10.40.0.4"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: CookAlongArtifact; warnings: string[] };
    expect(body.artifact.recipe.servings).toBe(4);
    expect(body.artifact.reviewNotes).toEqual([note]);
    expect(body.warnings).toContain(note.detail);
  });
});
