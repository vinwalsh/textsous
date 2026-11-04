/** Copy and links for the /assistants page (contract C7). Client-safe. */

export const TEXTSOUS_MCP_URL = "https://textsous.com/api/mcp";
export const TEXTSOUS_ASSISTANTS_URL = "https://textsous.com/assistants";
export const MUSE_URL = "https://muse.ai";

/** A recipe link we are willing to echo back into a prompt, else null. */
export function promptRecipeUrl(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function assistantPrompt(recipeUrl: string): string {
  return `Use TextSous to turn this recipe into a cook along: ${recipeUrl}`;
}
