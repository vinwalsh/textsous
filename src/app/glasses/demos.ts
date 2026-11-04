import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_RECIPE } from "../embed-demo/recipe";
import type { GlassesDemo } from "./GlassesApp";

/** The demo blog post converts its production address (cached by the warm). */
export const EMBED_DEMO_POST_URL = "https://open.textsous.com/embed-demo";

/** The /demo recipes, read the same way the /demo page reads them. */
function readUrls(): string[] {
  try {
    return readFileSync(join(process.cwd(), "eval/urls.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "1019627-sheet-pan-chicken" -> "Sheet pan chicken": the page's address, readable. Pure. */
export function slugTitle(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : "";
    const words = last
      .replace(/\.\w+$/, "")
      .replace(/^\d+-/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : hostOf(url);
  } catch {
    return url;
  }
}

/** The picker on /glasses: the 20 /demo recipes, then the /embed-demo post. */
export function glassesDemos(urls: readonly string[] = readUrls()): GlassesDemo[] {
  return [
    ...urls.map((url) => ({ url, host: hostOf(url), title: slugTitle(url) })),
    { url: EMBED_DEMO_POST_URL, host: "open.textsous.com", title: DEMO_RECIPE.title },
  ];
}
