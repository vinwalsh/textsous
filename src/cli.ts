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
import type { CanonicalizeInput, RecordingFile } from "./lib/stages/canonicalize";
import { renderGantt } from "./lib/gantt";
import { adjustArtifact, convertToArtifact } from "./lib/pipeline";
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
  .description("Convert a recipe URL or file to the Cook Along artifact")
  .argument("<input>", "https URL or path to an .html/.txt file")
  .requiredOption("--out <path>", "write Cook Along artifact JSON here")
  .option("--provider <name>", "meta|baseten", "meta")
  .option("--record", "save the model responses to eval/recordings (fixtures only)")
  .option("--timeline", "print a text Gantt of the timeline")
  .option("--servings <n>", "rescale to n servings (0.5-12)")
  .option("--dietary <target>", "apply a dietary variant")
  .option("--cuisine <name>", "infuse a cuisine")
  .option("--voice <name>", 'rewrite in a voice ("sous")')
  .action(
    async (
      input: string,
      options: {
        out: string;
        provider: string;
        record?: boolean;
        timeline?: boolean;
        servings?: string;
        dietary?: string;
        cuisine?: string;
        voice?: string;
      },
    ) => {
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
        const result = await convertToArtifact(data, { provider });
        const servings =
          options.servings === undefined ? undefined : Number(options.servings);
        if (servings !== undefined && !Number.isFinite(servings)) {
          throw new Error(`invalid servings "${options.servings}": expected a number`);
        }
        const adjustments = {
          ...(servings === undefined ? {} : { servings }),
          ...(options.dietary === undefined ? {} : { dietary: options.dietary }),
          ...(options.cuisine === undefined ? {} : { cuisine: options.cuisine }),
          ...(options.voice === undefined ? {} : { voice: options.voice }),
        };
        const adjusted =
          Object.keys(adjustments).length > 0
            ? await adjustArtifact(result.artifact, adjustments, { provider })
            : null;
        const artifact = adjusted?.artifact ?? result.artifact;
        await mkdir(path.dirname(options.out), { recursive: true });
        await writeFile(
          options.out,
          `${JSON.stringify(
            {
              artifact,
              schedule: result.schedule,
              stages: {
                canonicalize: {
                  checks: result.canonicalize.checks,
                  usage: result.canonicalize.usage,
                },
                procedure: {
                  checks: result.procedure.checks,
                  usage: result.procedure.usage,
                },
                review: { checks: result.review.checks, usage: result.review.usage },
              },
              usageTotal: result.usageTotal,
              ...(adjusted
                ? {
                    adjustments: {
                      ...adjustments,
                      scaleFlags: adjusted.scaleFlags,
                      usage: adjusted.usage,
                    },
                  }
                : {}),
            },
            null,
            2,
          )}\n`,
        );
        if (options.record) {
          const name = path.basename(input, path.extname(input));
          const base = path.basename(input);
          const stamped = new Date().toISOString();
          const canonPath = path.join("eval", "recordings", `${name}.json`);
          const canonRecording: RecordingFile = {
            version: 1,
            fixture: base,
            provider,
            model: config.model,
            recordedAt: stamped,
            usage: result.canonicalize.usage,
            input: data,
            response: result.canonicalize.rawResponse,
          };
          await writeFile(canonPath, `${JSON.stringify(canonRecording, null, 2)}\n`);
          console.log(`Recorded ${canonPath}`);
          const procPath = path.join("eval", "recordings", `procedure-${name}.json`);
          const procRecording: ProcedureRecordingFile = {
            version: 1,
            fixture: base,
            provider,
            model: config.model,
            recordedAt: stamped,
            usage: result.procedure.usage,
            recipe: result.recipe,
            response: result.procedure.rawResponse,
          };
          await writeFile(procPath, `${JSON.stringify(procRecording, null, 2)}\n`);
          console.log(`Recorded ${procPath}`);
        }
        const sched = result.schedule;
        const canonFailed = result.canonicalize.checks.filter((c) => !c.passed);
        const procFailed = result.procedure.checks.filter((c) => !c.passed);
        const reviewFailed = result.review.checks.filter((c) => !c.passed);
        console.log(`Title: ${artifact.recipe.title}`);
        console.log(
          `Tasks: ${artifact.timelineDefinition.tasks.length}, total time: ${sched.totalMinutes}m`,
        );
        console.log(
          `canonicalize: ${result.canonicalize.checks.map((c) => `${c.name}=${c.passed ? "pass" : "FAIL"}`).join(" ")}`,
        );
        console.log(
          `procedure: ${result.procedure.checks.map((c) => `${c.name}=${c.passed ? "pass" : "FAIL"}`).join(" ")}`,
        );
        console.log(
          `review: ${result.review.checks.length - reviewFailed.length}/${result.review.checks.length} pass`,
        );
        for (const c of [...canonFailed, ...procFailed, ...reviewFailed]) {
          console.log(`  FAIL ${c.name}: ${c.detail}`);
        }
        console.log(
          `Tokens per call: canonicalize=${result.canonicalize.usage.totalTokens} ` +
            `procedure=${result.procedure.usage.totalTokens} review=${result.review.usage.totalTokens} ` +
            `total=${result.usageTotal.totalTokens}`,
        );
        if (adjusted) {
          console.log(
            `Adjustments: ${Object.entries(adjustments)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")}`,
          );
          console.log(
            `Scale flags: ${
              adjusted.scaleFlags.length > 0
                ? adjusted.scaleFlags.map((f) => `"${f.token}" in ${f.stepId}`).join("; ")
                : "none"
            }`,
          );
          console.log(
            `Adjust tokens: scaling=${adjusted.usage.scaling.totalTokens} ` +
              `dietary=${adjusted.usage.dietary.totalTokens} cuisine=${adjusted.usage.cuisine.totalTokens} ` +
              `voice=${adjusted.usage.voice.totalTokens} total=${adjusted.usage.total.totalTokens}`,
          );
        }
        if (options.timeline) {
          console.log(renderGantt(artifact.recipe.title, artifact.timelineDefinition, sched));
        }
        console.log(`Wrote ${options.out} in ${Date.now() - started}ms`);
        if (canonFailed.length + procFailed.length + reviewFailed.length > 0) process.exitCode = 2;
      } catch (error) {
        const message = (error as Error).message;
        if (message.startsWith("compile blocked")) {
          console.error(`convert failed: ${message}`);
          process.exitCode = 2;
          return;
        }
        console.error(`convert failed: ${message}`);
        process.exitCode = 1;
      }
    },
  );

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
