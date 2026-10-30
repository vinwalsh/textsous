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

export default function DemoPage() {
  const urls = readUrls();
  return (
    <main>
      <h1>Demo recipes</h1>
      <p className="tagline">
        Twenty recipes with pre-warmed conversions — pick one to open it in the converter.
      </p>
      {urls.length === 0 ? (
        <p>No demo recipes are listed yet.</p>
      ) : (
        <ul className="changes">
          {urls.map((url) => (
            <li key={url}>
              <Link href={`/?url=${encodeURIComponent(url)}`} title={url}>
                {hostOf(url)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="meta">
        <Link href="/">Back to the converter</Link>
      </p>
    </main>
  );
}
