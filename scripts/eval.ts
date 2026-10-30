import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { canonicalize, type CanonicalizeInput } from "../src/lib/stages/canonicalize";
import { procedure } from "../src/lib/stages/procedure";
import { review } from "../src/lib/stages/review";
import { schedule } from "../src/lib/scheduler/schedule";
import { DEFAULT_EQUIPMENT_PROFILE } from "../src/lib/pipeline";
import {
  extractFromHtml,
  fetchAndExtract,
  type UrlExtraction,
} from "../src/lib/intake/url";
import { extractFromText } from "../src/lib/intake/text";
import type { ProviderName } from "../src/lib/model";

// `npm run eval`: convert the fixtures plus the URLs in eval/urls.txt (fetched
// at run time, never committed), score each run, and write eval/RESULTS.md.
// URL rows show URLs only — never titles, ingredients, or quoted text.

const FIXTURES = [
  "toasted-oat-porridge.html",
  "charred-corn-salad.html",
  "herby-white-bean-toast.txt",
];

interface EvalRow {
  input: string;
  kind: string;
  review: string;
  ingredCov: string;
  sourceTimed: string;
  schedMin: number;
  taskSumMin: number;
  fetchMs: number;
  canonMs: number;
  canonTok: number;
  procMs: number;
  procTok: number;
  revMs: number;
  revTok: number;
  tokTotal: number;
  costUsd: string;
  failed: string;
  error: string;
}

function readUrls(path: string): string[] {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function fromUrlExtraction(e: UrlExtraction): CanonicalizeInput {
  return {
    source: { kind: "url", url: e.canonicalUrl, site: e.site, author: e.author },
    title: e.title,
    ingredientLines: e.ingredientLines,
    instructionLines: e.instructionLines,
    servingsRaw: e.servingsRaw,
    rawText: e.rawText,
    hasJsonLd: e.hasJsonLd,
  };
}

function poolOf(e: UrlExtraction): string {
  const pool =
    e.hasJsonLd && e.ingredientLines.length > 0 ? e.ingredientLines.join("\n") : e.rawText;
  return pool.toLowerCase();
}

async function buildInput(
  source: { file?: string; url?: string },
): Promise<{ input: CanonicalizeInput; pool: string; fetchMs: number }> {
  if (source.url) {
    const start = Date.now();
    const extracted = await fetchAndExtract(source.url);
    return { input: fromUrlExtraction(extracted), pool: poolOf(extracted), fetchMs: Date.now() - start };
  }
  const file = source.file as string;
  const content = readFileSync(`eval/fixtures/${file}`, "utf8");
  if (file.endsWith(".html") || file.endsWith(".htm")) {
    const extracted = extractFromHtml(content, `https://example.com/${file}`);
    return { input: fromUrlExtraction(extracted), pool: poolOf(extracted), fetchMs: 0 };
  }
  const text = extractFromText(content);
  return {
    input: {
      source: { kind: "text" },
      rawText: text.rawText,
      ingredientLines: [],
      instructionLines: [],
      hasJsonLd: false,
    },
    pool: text.rawText.toLowerCase(),
    fetchMs: 0,
  };
}

function classifyError(message: string): string {
  if (
    /timed out|fetch failed|byte cap|content type|resolve host|redirect|status \d+|only https|private-network|credentials|invalid url/i.test(
      message,
    )
  ) {
    return "fetch-error";
  }
  if (/single-recipe|compile blocked/i.test(message)) return "review-blocked";
  if (/validation|valid json|empty content/i.test(message)) return "model-error";
  if (/missing model api key/i.test(message)) return "config-error";
  return "unknown-error";
}

function costOf(totalTok: number): string {
  const rate = Number(process.env.EVAL_USD_PER_MTOK);
  if (!Number.isFinite(rate) || rate <= 0) return "n/a";
  return `$${((totalTok / 1_000_000) * rate).toFixed(2)}`;
}

function failedRow(input: string, kind: string, error: unknown): EvalRow {
  const message = error instanceof Error ? error.message : "unknown error";
  return {
    input,
    kind,
    review: "—",
    ingredCov: "—",
    sourceTimed: "—",
    schedMin: 0,
    taskSumMin: 0,
    fetchMs: 0,
    canonMs: 0,
    canonTok: 0,
    procMs: 0,
    procTok: 0,
    revMs: 0,
    revTok: 0,
    tokTotal: 0,
    costUsd: "n/a",
    failed: "—",
    error: classifyError(message),
  };
}

async function evaluate(
  input: string,
  kind: string,
  source: { file?: string; url?: string },
  provider: ProviderName,
): Promise<EvalRow> {
  let built: { input: CanonicalizeInput; pool: string; fetchMs: number };
  try {
    built = await buildInput(source);
  } catch (error) {
    return failedRow(input, kind, error);
  }
  const failedNames: string[] = [];
  try {
    const canonStart = Date.now();
    const canon = await canonicalize(built.input, { provider });
    const canonMs = Date.now() - canonStart;
    const procStart = Date.now();
    const proc = await procedure(canon.recipe, { provider });
    const procMs = Date.now() - procStart;
    const sched = schedule(proc.timeline);
    const revStart = Date.now();
    const rev = await review(
      {
        recipe: canon.recipe,
        timeline: proc.timeline,
        schedule: sched,
        equipmentProfile: DEFAULT_EQUIPMENT_PROFILE,
      },
      { provider },
    );
    const revMs = Date.now() - revStart;

    for (const check of [...canon.checks, ...proc.checks, ...rev.checks]) {
      if (!check.passed) failedNames.push(check.name);
    }
    const revPassed = rev.checks.filter((c) => c.passed).length;
    const matched = canon.recipe.ingredients.filter((ing) =>
      ing.name ? built.pool.includes(ing.name.toLowerCase()) : false,
    ).length;
    const timed = proc.timeline.tasks.filter((t) => t.timingBasis === "source").length;
    const tokTotal =
      canon.usage.totalTokens + proc.usage.totalTokens + rev.usage.totalTokens;
    return {
      input,
      kind,
      review: `${revPassed}/${rev.checks.length}`,
      ingredCov: `${matched}/${canon.recipe.ingredients.length}`,
      sourceTimed: `${timed}/${proc.timeline.tasks.length}`,
      schedMin: sched.totalMinutes,
      taskSumMin: proc.timeline.tasks.reduce((sum, t) => sum + t.minutes, 0),
      fetchMs: built.fetchMs,
      canonMs,
      canonTok: canon.usage.totalTokens,
      procMs,
      procTok: proc.usage.totalTokens,
      revMs,
      revTok: rev.usage.totalTokens,
      tokTotal,
      costUsd: costOf(tokTotal),
      failed: failedNames.length === 0 ? "—" : [...new Set(failedNames)].join(", "),
      error: "—",
    };
  } catch (error) {
    const row = failedRow(input, kind, error);
    row.fetchMs = built.fetchMs;
    return row;
  }
}

function mean(values: number[]): string {
  if (values.length === 0) return "—";
  return String(Math.round(values.reduce((a, b) => a + b, 0) / values.length));
}

function renderMarkdown(rows: EvalRow[], provider: ProviderName): string {
  const header = [
    "<!-- GENERATED by `npm run eval`. Do not edit. URL rows show URLs only: third-party recipe text is never stored here. -->",
    "# Eval results",
    "",
    `Provider: ${provider}. review = passed/total review checks; ingred_cov = ingredient names found in the source; source_timed = tasks with source timing evidence; sched_min = scheduled total vs task_sum_min = summed task minutes.`,
    "",
    "| input | kind | review | ingred_cov | source_timed | sched_min | task_sum_min | fetch_ms | canon_ms | canon_tok | proc_ms | proc_tok | rev_ms | rev_tok | tok_total | cost_usd | failed | error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const lines = rows.map((r) =>
    [
      r.input,
      r.kind,
      r.review,
      r.ingredCov,
      r.sourceTimed,
      r.schedMin,
      r.taskSumMin,
      r.fetchMs,
      r.canonMs,
      r.canonTok,
      r.procMs,
      r.procTok,
      r.revMs,
      r.revTok,
      r.tokTotal,
      r.costUsd,
      r.failed,
      r.error,
    ].join(" | "),
  );
  const ok = rows.filter((r) => r.error === "—");
  const totalTok = ok.reduce((sum, r) => sum + r.tokTotal, 0);
  const footer = [
    "",
    `Runs: ${rows.length} (${ok.length} succeeded, ${rows.length - ok.length} failed). Total tokens: ${totalTok}.`,
    `Mean latency (ms) over succeeded runs: fetch ${mean(ok.map((r) => r.fetchMs))}, canonicalize ${mean(ok.map((r) => r.canonMs))}, procedure ${mean(ok.map((r) => r.procMs))}, review ${mean(ok.map((r) => r.revMs))}.`,
    "",
  ];
  return [...header, ...lines.map((l) => `| ${l} |`), ...footer].join("\n");
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("eval")
    .description("Score conversions over the fixtures and eval/urls.txt")
    .option("--fixtures-only", "skip URLs (for development)", false)
    .option("--limit <n>", "max URLs to run", "")
    .option("--out <path>", "results file", "eval/RESULTS.md")
    .option("--provider <name>", "meta|baseten", "meta");
  program.parse(process.argv);
  const opts = program.opts<{
    fixturesOnly: boolean;
    limit: string;
    out: string;
    provider: string;
  }>();
  if (opts.provider !== "meta" && opts.provider !== "baseten") {
    console.error('Unknown provider: use "meta" or "baseten".');
    process.exitCode = 1;
    return;
  }
  const provider = opts.provider as ProviderName;
  const limit = opts.limit === "" ? Number.POSITIVE_INFINITY : Number(opts.limit);
  if (!Number.isFinite(limit) && opts.limit !== "") {
    console.error("Limit must be a number.");
    process.exitCode = 1;
    return;
  }
  let urls = opts.fixturesOnly ? [] : readUrls("eval/urls.txt");
  if (urls.length === 0 && !opts.fixturesOnly) {
    console.log("No URLs in eval/urls.txt; running fixtures only.");
  }
  urls = urls.slice(0, limit);

  const rows: EvalRow[] = [];
  for (const file of FIXTURES) {
    console.log(`--- fixture ${file} ---`);
    const row = await evaluate(file, "fixture", { file }, provider);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  for (const url of urls) {
    console.log(`--- url ${url} ---`);
    const row = await evaluate(url, "url", { url }, provider);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(opts.out, renderMarkdown(rows, provider));
  console.log(`wrote ${opts.out} (${rows.length} rows)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
