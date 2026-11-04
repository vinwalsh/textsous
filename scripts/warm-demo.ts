import { readFileSync } from "node:fs";
import { Command } from "commander";

// `npm run warm -- --base https://open.textsous.com`: convert every /demo URL
// (eval/urls.txt) once through a deployed /api/convert, so the demo opens from
// the cache. Run it after any deploy that changes a stage version (the cache
// key includes them). One request at a time; cache hits are free. A fresh
// conversion uses one daily unit and one of the per-IP hourly requests, so a
// 429 stops the run: run it again later and it picks up where it stopped.
// Prints URLs and status only, never recipe content.

/** Non-empty, non-comment lines of a URL list. Pure. */
export function parseUrlList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

const TIMEOUT_MS = 430_000;

async function warmOne(base: string, url: string): Promise<{ status: number | null; cached: boolean | null; reason: string | null; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/api/convert", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { cached?: boolean; reason?: string } | null;
    return {
      status: res.status,
      cached: typeof data?.cached === "boolean" ? data.cached : null,
      reason: typeof data?.reason === "string" ? data.reason : null,
      ms: Date.now() - started,
    };
  } catch {
    return { status: null, cached: null, reason: "timeout or network error", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .name("warm-demo")
    .requiredOption("--base <origin>", "deployed origin, e.g. https://open.textsous.com")
    .option("--list <file>", "URL list", "eval/urls.txt")
    .option("--dry-run", "print the URLs without converting");
  program.parse();
  const opts = program.opts<{ base: string; list: string; dryRun?: boolean }>();
  const urls = parseUrlList(readFileSync(opts.list, "utf8"));
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    if (opts.dryRun) {
      console.log(`${i + 1}/${urls.length} ${url}`);
      continue;
    }
    const result = await warmOne(opts.base, url);
    const what =
      result.status === 200 ? (result.cached ? "cache hit" : "converted") : `failed (${result.reason ?? "see logs"})`;
    console.log(`${i + 1}/${urls.length} ${result.status ?? "-"} ${what} ${Math.round(result.ms / 1000)} s ${url}`);
    if (result.status === 429) {
      console.log("Stopped at a limit. Run again later; cached URLs are skipped for free.");
      process.exitCode = 1;
      return;
    }
    if (result.status !== 200) failed += 1;
  }
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && /warm-demo\.ts$/.test(process.argv[1])) {
  void main();
}
