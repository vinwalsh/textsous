import { z } from "zod";
import { logEvent } from "../../../../lib/log";
import { getRecipeSource } from "../../../../lib/skills";
import { checkSecret, checkSkillsRateLimit, failure, jsonResponse, readJsonBody } from "../../../../lib/skills/http";

export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1) });

/**
 * Secret: fetch one recipe page through the SSRF-guarded intake and return
 * its credit, schema.org Recipe fields and readable text. No model calls,
 * no daily cap.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const denied = checkSecret(req);
  if (denied) return denied;
  const body = await readJsonBody(req);
  if ("response" in body) return body.response;
  const limited = await checkSkillsRateLimit(req);
  if (limited) return limited;
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(422, "refused_url", 'Send { "url": "https://..." } with the recipe page link.');
  }
  const result = await getRecipeSource(parsed.data.url);
  logEvent("skills_source", {
    ok: result.ok,
    code: result.ok ? null : result.error.code,
    durationMs: Date.now() - started,
  });
  if (!result.ok) return jsonResponse(result, 422);
  return jsonResponse(result);
}
