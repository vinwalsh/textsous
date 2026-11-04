/**
 * Offline Cook Along artifact from a recorded fixture conversion: the
 * recorded procedure response, the deterministic schedule and coded review
 * checks, then compile. No model calls (the model review judgments are not
 * replayed), so this is for UI tests and local demos only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_EQUIPMENT_PROFILE } from "../../src/lib/pipeline";
import type { CookAlongArtifact } from "../../src/lib/schema/artifact";
import { TimelineDefinitionSchema } from "../../src/lib/schema/timeline";
import { schedule } from "../../src/lib/scheduler/schedule";
import { compile } from "../../src/lib/stages/compile";
import type { ProcedureRecordingFile } from "../../src/lib/stages/procedure";
import { runCodedReviewChecks } from "../../src/lib/stages/review";

export function fixtureArtifact(
  name = "toasted-oat-porridge",
  root = process.cwd(),
): CookAlongArtifact {
  const recording = JSON.parse(
    readFileSync(join(root, "eval/recordings", `procedure-${name}.json`), "utf8"),
  ) as ProcedureRecordingFile;
  const timeline = TimelineDefinitionSchema.parse(JSON.parse(recording.response));
  const sched = schedule(timeline);
  const checks = runCodedReviewChecks({
    recipe: recording.recipe,
    timeline,
    schedule: sched,
    equipmentProfile: DEFAULT_EQUIPMENT_PROFILE,
  });
  const failed = checks.filter((c) => !c.passed);
  return compile({
    recipe: recording.recipe,
    timeline,
    review: {
      checks,
      passed: failed.length === 0,
      blockers: failed.map((c) => `${c.name}: ${c.detail}`),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      fallbackUsed: false,
      attempts: 0,
      rawResponse: "",
    },
    equipmentProfile: DEFAULT_EQUIPMENT_PROFILE,
  });
}
