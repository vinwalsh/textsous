import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";

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

/** The page's own address segment, shown as printed so two recipes on one site differ. */
function pageSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : "";
  } catch {
    return "";
  }
}

export default function DemoPage() {
  const urls = readUrls();
  return (
    <main>
      <h1>Demo recipes</h1>
      <p className="tagline">
        Twenty recipes we test with. Pick one and it opens as a cook along: one converted
        recently opens right away; a fresh conversion takes 3 to 4 minutes.
      </p>
      {urls.length === 0 ? (
        <p>No demo recipes are listed yet.</p>
      ) : (
        <ul className="card demo-list">
          {urls.map((url) => (
            <li key={url}>
              <Link href={`/?url=${encodeURIComponent(url)}`} title={url}>
                <span className="demo-host">{hostOf(url)}</span>
                <span className="demo-slug">{pageSlug(url)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="meta">
        Have a recipe site? See the{" "}
        <Link href="/embed-demo">Cook Along button on a demo blog post</Link>.
      </p>
      <p className="meta">
        <Link href="/">Back to the converter</Link>
      </p>
    </main>
  );
}
