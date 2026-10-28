import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { z } from "zod";
import {
  callStructured,
  isContributorModel,
  resolveProvider,
  type ProviderName,
} from "./lib/model";
import { extractFromHtml, fetchAndExtract, type UrlExtraction } from "./lib/intake/url";
import { extractFromText } from "./lib/intake/text";
import {
  canonicalize,
  type CanonicalizeInput,
  type RecordingFile,
} from "./lib/stages/canonicalize";
import { CanonicalRecipeSchema } from "./lib/schema/canonical";
import { procedure, type ProcedureRecordingFile } from "./lib/stages/procedure";

function parseProvider(raw: string): ProviderName {
  if (raw === "meta" || raw === "baseten") return raw;
  throw new Error(`Unknown provider "${raw}": use meta or baseten.`);
}

/** Contributor-tier models may only run locally on fixtures we wrote. */
function isFixtureInput(input: string): boolean {
  if (/^https?:\/\//i.test(input)) return false;
  const resolved = path.resolve(input);
  const fixtures = path.resolve("eval/fixtures");
  return resolved === fixtures || resolved.startsWith(`${fixtures}${path.sep}`);
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

async function buildInput(input: string): Promise<CanonicalizeInput> {
  if (input.startsWith("https://")) {
    return fromUrlExtraction(await fetchAndExtract(input));
  }
  if (/^https?:\/\//i.test(input)) {
    throw new Error("Only https URLs can be fetched; http is refused.");
  }
  const content = await readFile(input, "utf8").catch(() => {
    throw new Error(`Cannot read file: ${input}`);
  });
  if (input.endsWith(".html") || input.endsWith(".htm")) {
    const base = `https://example.com/${path.basename(input)}`;
    return fromUrlExtraction(extractFromHtml(content, base));
  }
  const text = extractFromText(content);
  return {
    source: { kind: "text" },
    rawText: text.rawText,
    ingredientLines: [],
    instructionLines: [],
    hasJsonLd: false,
  };
}

const program = new Command();
program.name("textsous").description("TextSous open-source recipe tools").showHelpAfterError();

program
  .command("convert")
  .description("Convert a recipe URL or file to the canonical recipe JSON")
  .argument("<input>", "https URL or path to an .html/.txt file")
  .requiredOption("--out <path>", "write canonical recipe JSON here")
  .option("--provider <name>", "meta|baseten", "meta")
  .option("--record", "save the raw model response to eval/recordings (fixtures only)")
  .action(async (input: string, options: { out: string; provider: string; record?: boolean }) => {
    try {
      const provider = parseProvider(options.provider);
      const config = resolveProvider(provider);
      if (isContributorModel(config.model) && !isFixtureInput(input)) {
        console.error(
          `Refusing: contributor-tier model "${config.model}" may only run locally on fixtures under eval/fixtures.`,
        );
        process.exitCode = 1;
        return;
      }
      if (options.record && !isFixtureInput(input)) {
        console.error("Refusing: --record only saves responses for fixtures under eval/fixtures.");
        process.exitCode = 1;
        return;
      }
      const data = await buildInput(input);
      console.log(`Converting ${input} (${provider}/${config.model})...`);
      const started = Date.now();
      const result = await canonicalize(data, { provider });
      await mkdir(path.dirname(options.out), { recursive: true });
      await writeFile(
        options.out,
        `${JSON.stringify({ recipe: result.recipe, checks: result.checks }, null, 2)}\n`,
      );
      if (options.record) {
        const name = path.basename(input, path.extname(input));
        const recordPath = path.join("eval", "recordings", `${name}.json`);
        const recording: RecordingFile = {
          version: 1,
          fixture: path.basename(input),
          provider,
          model: config.model,
          recordedAt: new Date().toISOString(),
          usage: result.usage,
          input: data,
          response: result.rawResponse,
        };
        await writeFile(recordPath, `${JSON.stringify(recording, null, 2)}\n`);
        console.log(`Recorded ${recordPath}`);
      }
      const failed = result.checks.filter((c) => !c.passed);
      console.log(`Title: ${result.recipe.title}`);
      console.log(
        `Ingredients: ${result.recipe.ingredients.length}, steps: ${result.recipe.steps.length}`,
      );
      console.log(
        `Checks: ${result.checks.map((c) => `${c.name}=${c.passed ? "pass" : "FAIL"}`).join(" ")}`,
      );
      for (const c of failed) console.log(`  FAIL ${c.name}: ${c.detail}`);
      console.log(
        `Tokens: prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens} ` +
          `(attempts=${result.attempts}, fallback=${result.fallbackUsed ? "json-mode" : "no"})`,
      );
      console.log(`Wrote ${options.out} in ${Date.now() - started}ms`);
      if (failed.length > 0) process.exitCode = 2;
    } catch (error) {
      console.error(`convert failed: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("procedure")
  .description("Build a component-lane timeline from a canonical recipe JSON file")
  .argument("<input>", "path to a canonical recipe JSON file ({recipe} or bare recipe)")
  .requiredOption("--out <path>", "write timeline JSON here")
  .option("--provider <name>", "meta|baseten", "meta")
  .option("--record [name]", "save the raw model response to eval/recordings")
  .action(
    async (input: string, options: { out: string; provider: string; record?: boolean | string }) => {
      try {
        const provider = parseProvider(options.provider);
        const config = resolveProvider(provider);
        const raw = JSON.parse(
          await readFile(input, "utf8").catch(() => {
            throw new Error(`Cannot read file: ${input}`);
          }),
        ) as unknown;
        const recipeRaw = (raw as { recipe?: unknown }).recipe ?? raw;
        const parsed = CanonicalRecipeSchema.safeParse(recipeRaw);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
          throw new Error(`Input is not a canonical recipe: ${issues}`);
        }
        console.log(`Building timeline for ${input} (${provider}/${config.model})...`);
        const started = Date.now();
        const result = await procedure(parsed.data, { provider });
        await mkdir(path.dirname(options.out), { recursive: true });
        await writeFile(
          options.out,
          `${JSON.stringify({ timeline: result.timeline, checks: result.checks }, null, 2)}\n`,
        );
        if (options.record !== undefined) {
          const name =
            typeof options.record === "string" && options.record.length > 0
              ? options.record
              : path.basename(input, path.extname(input));
          const recordPath = path.join("eval", "recordings", `procedure-${name}.json`);
          const recording: ProcedureRecordingFile = {
            version: 1,
            fixture: path.basename(input),
            provider,
            model: config.model,
            recordedAt: new Date().toISOString(),
            usage: result.usage,
            recipe: parsed.data,
            response: result.rawResponse,
          };
          await writeFile(recordPath, `${JSON.stringify(recording, null, 2)}\n`);
          console.log(`Recorded ${recordPath}`);
        }
        const failed = result.checks.filter((c) => !c.passed);
        console.log(
          `Lanes: ${result.timeline.lanes.length}, tasks: ${result.timeline.tasks.length}, resources: ${result.timeline.resources.length}`,
        );
        console.log(
          `Checks: ${result.checks.map((c) => `${c.name}=${c.passed ? "pass" : "FAIL"}`).join(" ")}`,
        );
        for (const c of failed) console.log(`  FAIL ${c.name}: ${c.detail}`);
        console.log(
          `Tokens: prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens} ` +
            `(attempts=${result.attempts}, fallback=${result.fallbackUsed ? "json-mode" : "no"})`,
        );
        console.log(`Wrote ${options.out} in ${Date.now() - started}ms`);
        if (failed.length > 0) process.exitCode = 2;
      } catch (error) {
        console.error(`procedure failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

program
  .command("smoke")
  .description("One tiny structured call per provider, printing model id and token usage")
  .option("--provider <name>", "meta|baseten|all", "all")
  .action(async (options: { provider: string }) => {
    const providers: ProviderName[] =
      options.provider === "all" ? ["meta", "baseten"] : [parseProvider(options.provider)];
    const schema = z.strictObject({ echo: z.string() });
    let failed = 0;
    for (const provider of providers) {
      const config = resolveProvider(provider);
      try {
        const result = await callStructured(
          schema,
          [{ role: "user", content: 'Reply with {"echo":"hi"} and nothing else.' }],
          { provider, schemaName: "smoke_echo" },
        );
        console.log(
          `${provider}: model=${result.model} echo=${JSON.stringify(result.data.echo)} ` +
            `tokens=${result.usage.totalTokens} (p=${result.usage.promptTokens}, c=${result.usage.completionTokens}) ` +
            `fallback=${result.fallbackUsed ? "json-mode" : "no"}`,
        );
      } catch (error) {
        failed += 1;
        console.log(`${provider}: model=${config.model} ERROR: ${(error as Error).message}`);
      }
    }
    if (failed > 0) process.exitCode = 1;
  });

await program.parseAsync(process.argv);
