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
import { clientIp } from "../convert/route";

const BodySchema = z.strictObject({ artifact: z.unknown() });

/**
 * Store an artifact under a random id for 24 hours and return the signed
 * fetch URL. No daily cap: storing spends no model calls.
 */
export async function POST(req: Request) {
  const limited = await checkRateLimit(`artifact:${clientIp(req)}`);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 },
    );
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request body must be a JSON object with an artifact field." },
      { status: 400 },
    );
  }
  const valid = CookAlongArtifactSchema.safeParse(parsed.data.artifact);
  if (!valid.success) {
    return NextResponse.json({ error: "Invalid artifact." }, { status: 400 });
  }
  let secret: string;
  try {
    secret = artifactSigningSecret();
  } catch {
    return NextResponse.json({ error: "Artifact signing is not configured." }, { status: 500 });
  }
  let saved;
  try {
    saved = await saveArtifact(valid.data);
  } catch {
    return NextResponse.json({ error: "Could not store the artifact." }, { status: 500 });
  }
  const sig = signArtifactId(saved.id, saved.expiresAt, secret);
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    url: buildSignedArtifactUrl(origin, saved.id, sig),
    expiresAt: saved.expiresAt,
  });
}
