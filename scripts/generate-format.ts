import { writeFileSync } from "node:fs";
import { CookAlongArtifactSchema } from "../src/lib/schema/artifact";
import { CanonicalRecipeSchema } from "../src/lib/schema/canonical";
import { TimelineDefinitionSchema } from "../src/lib/schema/timeline";
import { VariantTransformSchema } from "../src/lib/schema/variant";
import { toResponseJsonSchema } from "../src/lib/schema/json";

// Regenerates docs/FORMAT.md from the zod schemas: every field gets a line.
// Deterministic: no timestamps, fields in schema order. CI fails when the
// committed copy differs from a fresh run.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface Unwrapped {
  schema: Record<string, unknown>;
  nullable: boolean;
}

/** Peel anyOf/type nullability so the rest reads one plain schema. */
function unwrap(node: unknown): Unwrapped {
  if (!isObject(node)) return { schema: {}, nullable: false };
  const anyOf = node.anyOf;
  if (Array.isArray(anyOf)) {
    const branches = anyOf.filter(isObject);
    const nullable = branches.some((branch) => branch.type === "null");
    const main = branches.find((branch) => branch.type !== "null") ?? {};
    return { schema: main, nullable };
  }
  const type = node.type;
  if (Array.isArray(type)) {
    const nullable = type.includes("null");
    const main = type.find((entry) => entry !== "null");
    return { schema: { ...node, type: main }, nullable };
  }
  return { schema: node, nullable: false };
}

function constraintText(schema: Record<string, unknown>): string {
  const constraints: string[] = [];
  if (typeof schema.minLength === "number") constraints.push(`min length ${schema.minLength}`);
  if (typeof schema.exclusiveMinimum === "number") {
    constraints.push(`> ${schema.exclusiveMinimum}`);
  }
  if (typeof schema.minimum === "number") constraints.push(`>= ${schema.minimum}`);
  if (typeof schema.exclusiveMaximum === "number") {
    constraints.push(`< ${schema.exclusiveMaximum}`);
  }
  if (typeof schema.maximum === "number") constraints.push(`<= ${schema.maximum}`);
  if (typeof schema.minItems === "number") constraints.push(`min ${schema.minItems} items`);
  if (typeof schema.maxItems === "number") constraints.push(`max ${schema.maxItems} items`);
  const enums = Array.isArray(schema.enum) ? schema.enum : [];
  if (enums.length === 1) constraints.push(`must be ${formatValue(enums[0])}`);
  else if (enums.length > 1) {
    constraints.push(`one of: ${enums.map(formatValue).join(", ")}`);
  }
  return constraints.length > 0 ? ` (${constraints.join("; ")})` : "";
}

function describeNode(path: string, node: unknown, out: string[]): void {
  const { schema, nullable } = unwrap(node);
  const type = schema.type;
  const suffix = nullable ? " or null" : "";

  if (type === "object") {
    const props = isObject(schema.properties) ? schema.properties : {};
    if (path) out.push(`- \`${path}\`: object${suffix}${constraintText(schema)}`);
    for (const [key, child] of Object.entries(props)) {
      describeNode(path ? `${path}.${key}` : key, child, out);
    }
    return;
  }
  if (type === "array") {
    const items = unwrap(schema.items);
    const itemType = typeof items.schema.type === "string" ? items.schema.type : "value";
    let line =
      `- \`${path}\`: array of ${itemType}` +
      `${items.nullable ? " or null" : ""}${suffix}${constraintText(schema)}`;
    const itemEnums = Array.isArray(items.schema.enum) ? items.schema.enum : [];
    if (itemEnums.length > 0 && itemType !== "object") {
      line +=
        itemEnums.length === 1
          ? ` (must be ${formatValue(itemEnums[0])})`
          : ` (one of: ${itemEnums.map(formatValue).join(", ")})`;
    }
    out.push(line);
    if (itemType === "object") {
      const props = isObject(items.schema.properties) ? items.schema.properties : {};
      for (const [key, child] of Object.entries(props)) {
        describeNode(`${path}[].${key}`, child, out);
      }
    }
    return;
  }
  const typeName = typeof type === "string" ? type : "value";
  out.push(`- \`${path}\`: ${typeName}${suffix}${constraintText(schema)}`);
}

const documents = [
  {
    title: "Canonical recipe",
    file: "canonical.json",
    schema: toResponseJsonSchema(CanonicalRecipeSchema),
    blurb:
      "One recipe exactly as the source states it: ingredients, ordered steps, equipment and credit.",
  },
  {
    title: "Timeline definition",
    file: "timeline.json",
    schema: toResponseJsonSchema(TimelineDefinitionSchema),
    blurb:
      "The component-lane cooking plan: lanes, phases, timed tasks, resources and the serve task.",
  },
  {
    title: "Cook Along artifact",
    file: "artifact.json",
    schema: toResponseJsonSchema(CookAlongArtifactSchema),
    blurb: "The handoff document: recipe, timeline, equipment profile and the change record.",
  },
  {
    title: "Variant transform",
    file: "variant.json",
    schema: toResponseJsonSchema(VariantTransformSchema),
    blurb:
      "Dietary and cuisine adjustments as ingredient swaps, step overrides and technique changes.",
  },
];

const lines = [
  "<!-- GENERATED from the zod schemas in src/lib/schema/. Do not edit by hand. Regenerate with `npm run docs`. -->",
  "# TextSous Cook Along format",
  "",
  "The open format for converted recipes: a canonical recipe, a component-lane",
  "cooking timeline, and adjustable variants. This is draft version 1.",
  "",
  "The normative definitions are the JSON Schemas in `docs/schema/*.json`,",
  "generated from the same zod schemas by `npm run schema`; textsous.com",
  "validates imports against those files. Every field below has a line.",
  "",
];

for (const doc of documents) {
  lines.push(`## ${doc.title} (\`docs/schema/${doc.file}\`)`, "", doc.blurb, "");
  describeNode("", doc.schema, lines);
  lines.push("");
}

writeFileSync("docs/FORMAT.md", `${lines.join("\n")}`);
console.log("wrote docs/FORMAT.md");
