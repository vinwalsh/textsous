import { artifactSigningSecret, saveArtifact, signArtifactId } from "../../../../lib/artifact-store";
import { buildSignedArtifactUrl } from "../../../../lib/handoff";
import { logEvent } from "../../../../lib/log";
import { prepareCookAlong } from "../../../../lib/skills";
import {
  buildViewUrl,
  checkSecret,
  checkSkillsRateLimit,
  failure,
  jsonResponse,
  publicOrigin,
  readJsonBody,
} from "../../../../lib/skills/http";

export const maxDuration = 60;

/**
 * Secret: validate, schedule, compile and store a cook along an AI assistant
 * wrote with its own model. No model calls, no daily cap. 422 returns
 * path-specific errors the assistant can fix and resend.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const denied = checkSecret(req);
  if (denied) return denied;
  const body = await readJsonBody(req);
  if ("response" in body) return body.response;
  const limited = await checkSkillsRateLimit(req);
  if (limited) return limited;

  let secret: string;
  try {
    secret = artifactSigningSecret();
  } catch {
    return failure(503, "not_configured", "Artifact signing is not configured on this server.");
  }

  const prepared = await prepareCookAlong(body.value);
  if (!prepared.ok) {
    logEvent("skills_cook_along", {
      ok: false,
      errorCount: prepared.errors.length,
      codes: [...new Set(prepared.errors.map((e) => e.code))],
      durationMs: Date.now() - started,
    });
    return jsonResponse({ ok: false, errors: prepared.errors, warnings: prepared.warnings }, 422);
  }

  let saved;
  try {
    saved = await saveArtifact(prepared.artifact);
  } catch {
    return failure(500, "internal", "The Cook Along could not be stored. Try again.");
  }
  const origin = publicOrigin(req);
  const artifactUrl = buildSignedArtifactUrl(origin, saved.id, signArtifactId(saved.id, saved.expiresAt, secret));
  logEvent("skills_cook_along", {
    ok: true,
    kind: prepared.artifact.recipe.credit.kind,
    taskCount: prepared.summary.taskCount,
    warningCount: prepared.warnings.length,
    durationMs: Date.now() - started,
  });
  return jsonResponse({
    ok: true,
    artifactId: saved.id,
    artifactUrl,
    viewUrl: buildViewUrl(origin, artifactUrl),
    expiresAt: new Date(saved.expiresAt * 1000).toISOString(),
    summary: prepared.summary,
    warnings: prepared.warnings,
  });
}
