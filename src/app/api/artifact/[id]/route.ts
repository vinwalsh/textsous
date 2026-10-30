import { NextResponse } from "next/server";
import {
  artifactSigningSecret,
  isArtifactId,
  loadArtifact,
  verifyArtifactSignature,
} from "../../../../lib/artifact-store";

/**
 * Fetch a stored artifact by id. The HMAC signature covers the id and
 * expiry; textsous.com fetches this server to server, so no CORS. Reads do
 * not consume the record: sign-in can interrupt the first fetch, so the URL
 * may be fetched more than once. Expired or missing records are 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isArtifactId(id)) {
    return NextResponse.json({ error: "Not found or expired." }, { status: 404 });
  }
  const record = await loadArtifact(id);
  if (!record) {
    return NextResponse.json({ error: "Not found or expired." }, { status: 404 });
  }
  let secret: string;
  try {
    secret = artifactSigningSecret();
  } catch {
    return NextResponse.json({ error: "Artifact signing is not configured." }, { status: 500 });
  }
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!verifyArtifactSignature(id, record.expiresAt, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }
  return NextResponse.json(record.artifact);
}
