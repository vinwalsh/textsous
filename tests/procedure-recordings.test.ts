import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TimelineDefinitionSchema } from "../src/lib/schema/timeline";
import {
  runProcedureChecks,
  type ProcedureRecordingFile,
} from "../src/lib/stages/procedure";

function loadRecording(name: string): ProcedureRecordingFile {
  return JSON.parse(readFileSync(`eval/recordings/${name}.json`, "utf8"));
}

describe("recorded procedure responses", () => {
  for (const name of [
    "procedure-toasted-oat-porridge",
    "procedure-charred-corn-salad",
    "procedure-herby-white-bean-toast",
  ]) {
    it(`passes all deterministic checks for ${name}`, () => {
      const recording = loadRecording(name);
      const parsed = TimelineDefinitionSchema.safeParse(JSON.parse(recording.response));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const failed = runProcedureChecks(recording.recipe, parsed.data).filter((c) => !c.passed);
      expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([]);
    });
  }
});
