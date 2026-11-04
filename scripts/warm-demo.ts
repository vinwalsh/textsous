import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Command } from "commander";

// `npm run warm -- --base https://open.textsous.com`: convert every /demo URL
// (eval/urls.txt) and the /embed-demo post once through a deployed
// /api/convert, so the demo and the embed showcase open from the cache. Run
// it after any deploy that changes a stage version (the cache key includes
// them), against production (a protected preview cannot fetch itself). One
// request at a time; cache hits are free. A fresh conversion uses one daily
// unit and one of this network's 20 hourly conversions, so run it from a
// network you are not using for demos, and a 429 stops the run: run it again
// later and it picks up where it stopped. Prints URLs and status only, never
// recipe content.

/** Non-empty, non-comment lines of a URL list. Pure. */
export function parseUrlList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Longer than the convert route's 420 s limit, so its own answer arrives first. */
const TIMEOUT_MS = 430_000;

/**
 * The URLs to warm: the /demo list, then the /embed-demo post's own address
 * (what embed.js sends when the post has no ?src=). Only for an https base:
 * the converter refuses http, so a local run skips the post. Pure.
 */
export function warmTargets(urls: readonly string[], base: string): string[] {
  const origin = new URL(base);
  if (origin.protocol !== "https:") return [...urls];
  return [...urls, new URL("/embed-demo", origin).href];
}

/**
 * POST JSON and wait up to timeoutMs for the whole answer. node:http(s), not
 * fetch: Node's fetch stops waiting for response headers after 300 s, and
 * /api/convert sends nothing until a conversion finishes (up to 400 s).
 */
export function postJson(url: URL, body: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const send = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = send(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer after ${Math.round(timeoutMs / 1000)} s`)));
    req.on("error", reject);
    req.end(payload);
  });
}

export async function warmOne(
  base: string,
  url: string,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: number | null; cached: boolean | null; reason: string | null; ms: number }> {
  const started = Date.now();
  try {
    const res = await postJson(new URL("/api/convert", base), { url }, timeoutMs);
    let data: { cached?: unknown; reason?: unknown } | null = null;
    try {
      data = JSON.parse(res.text) as { cached?: unknown; reason?: unknown };
    } catch {
      data = null;
    }
    return {
      status: res.status,
      cached: typeof data?.cached === "boolean" ? data.cached : null,
      reason: typeof data?.reason === "string" ? data.reason : null,
      ms: Date.now() - started,
    };
  } catch {
    return { status: null, cached: null, reason: "timeout or network error", ms: Date.now() - started };
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
  const urls = warmTargets(parseUrlList(readFileSync(opts.list, "utf8")), opts.base);
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
    if (result.status === null && result.ms >= 290_000) {
      // The server may still be converting: it caches the result when done.
      console.log("  The server may still be converting this one; a re-run will show it as a cache hit.");
    }
    if (result.status !== 200) failed += 1;
  }
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && /warm-demo\.ts$/.test(process.argv[1])) {
  void main();
}
