import { NextResponse } from "next/server";
import {
  artifactSigningSecret,
  isArtifactId,
  loadArtifact,
  verifyArtifactSignature,
} from "../../../../lib/artifact-store";
import { fail } from "../../helpers";

export const maxDuration = 30;

const ROUTE = "artifact_get";

/**
 * Fetch a stored artifact by id. The HMAC signature covers the id and
 * expiry; textsous.com fetches this server to server, so no CORS. Reads do
 * not consume the record: sign-in can interrupt the first fetch, so the URL
 * may be fetched more than once. Expired or missing records are 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isArtifactId(id)) {
    return fail(ROUTE, 404, { error: "Not found or expired." });
  }
  const record = await loadArtifact(id);
  if (!record) {
    return fail(ROUTE, 404, { error: "Not found or expired." });
  }
  let secret: string;
  try {
    secret = artifactSigningSecret();
  } catch (error) {
    return fail(ROUTE, 500, { error: "Artifact signing is not configured." }, error);
  }
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!verifyArtifactSignature(id, record.expiresAt, sig, secret)) {
    return fail(ROUTE, 403, { error: "Invalid signature." });
  }
  return NextResponse.json(record.artifact);
}
