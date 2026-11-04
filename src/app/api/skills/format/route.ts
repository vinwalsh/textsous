import { COOK_ALONG_EXAMPLE, SKILLS_INSTRUCTIONS, SKILLS_VERSION, cookAlongInputJsonSchema } from "../../../../lib/skills";
import { jsonResponse } from "../../../../lib/skills/http";

export const maxDuration = 60;

/**
 * Public: how an AI assistant writes a TextSous Cook Along. Instructions
 * (markdown), the JSON Schema of the cook-along body, and a complete valid
 * example. No secret, no model calls, no daily cap.
 */
export function GET() {
  return jsonResponse(
    {
      skillsVersion: SKILLS_VERSION,
      formatVersion: 1,
      instructions: SKILLS_INSTRUCTIONS,
      inputSchema: cookAlongInputJsonSchema(),
      example: COOK_ALONG_EXAMPLE,
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}
