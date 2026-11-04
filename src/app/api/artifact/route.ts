import { NextResponse } from "next/server";
import { z } from "zod";
import { CookAlongArtifactSchema } from "../../../lib/schema/artifact";
import {
  artifactSigningSecret,
  saveArtifact,
  signArtifactId,
} from "../../../lib/artifact-store";
import { buildSignedArtifactUrl } from "../../../lib/handoff";
import { checkRateLimit } from "../../../lib/limits";
import { clientIp, fail, limited, readJsonBody, TOO_LARGE_MESSAGE } from "../helpers";

export const maxDuration = 30;

const ROUTE = "artifact";

const BodySchema = z.strictObject({ artifact: z.unknown() });

/**
 * Store an artifact under a random id for 24 hours and return the signed
 * fetch URL. No daily cap: storing spends no model calls.
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body.ok) return fail(ROUTE, 413, { error: TOO_LARGE_MESSAGE });
  const rate = await checkRateLimit(`artifact:${clientIp(req)}`);
  if (!rate.allowed) return limited(ROUTE, "rate_limited");
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) {
    return fail(ROUTE, 400, {
      error: "Request body must be a JSON object with an artifact field.",
    });
  }
  const valid = CookAlongArtifactSchema.safeParse(parsed.data.artifact);
  if (!valid.success) {
    return fail(ROUTE, 400, { error: "Invalid artifact." });
  }
  let secret: string;
  try {
    secret = artifactSigningSecret();
  } catch (error) {
    return fail(ROUTE, 500, { error: "Artifact signing is not configured." }, error);
  }
  let saved;
  try {
    saved = await saveArtifact(valid.data);
  } catch (error) {
    return fail(ROUTE, 500, { error: "Could not store the artifact." }, error);
  }
  const sig = signArtifactId(saved.id, saved.expiresAt, secret);
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    url: buildSignedArtifactUrl(origin, saved.id, sig),
    expiresAt: saved.expiresAt,
  });
}
