import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CanonicalRecipeSchema } from "../src/lib/schema/canonical";
import { runCanonicalChecks, type RecordingFile } from "../src/lib/stages/canonicalize";

function loadRecording(name: string): RecordingFile {
  return JSON.parse(readFileSync(`eval/recordings/${name}.json`, "utf8")) as RecordingFile;
}

describe("recorded canonicalize responses", () => {
  for (const name of [
    "toasted-oat-porridge",
    "charred-corn-salad",
    "herby-white-bean-toast",
  ]) {
    it(`passes all deterministic checks for ${name}`, () => {
      const recording = loadRecording(name);
      const parsed = CanonicalRecipeSchema.safeParse(JSON.parse(recording.response));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const checks = runCanonicalChecks(recording.input, parsed.data);
      expect(
        checks
          .filter((c) => !c.passed)
          .map((c) => `${c.name}: ${c.detail}`),
      ).toEqual([]);
    });
  }

  it("fails ingredient_count for a doctored recording with a dropped ingredient", () => {
    const recording = loadRecording("toasted-oat-porridge.doctored");
    const parsed = CanonicalRecipeSchema.safeParse(JSON.parse(recording.response));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const failed = runCanonicalChecks(recording.input, parsed.data).filter((c) => !c.passed);
    expect(failed.map((c) => c.name)).toContain("ingredient_count");
  });
});
