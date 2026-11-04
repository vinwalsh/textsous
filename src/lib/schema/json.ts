import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Convert a zod schema to an inlined JSON Schema object suitable for
 * `response_format: { type: "json_schema", json_schema: { name, schema } }`.
 *
 * Guarantees, per repo rules:
 * - no `$ref` (inlined via `$refStrategy: "none"`)
 * - `additionalProperties: false` on every object
 * - every property listed in `required`
 * - `const` rewritten to a single-value `enum` (strict providers reject `const`)
 * - no `$schema` key (rejected by some providers in response_format)
 *
 * Keep API schemas free of refinements, transforms and defaults:
 * zod-to-json-schema cannot represent them.
 */
export function toResponseJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema, true);
}

/**
 * Consumer-facing JSON Schema for docs/schema/*.json: same shape as the
 * model-facing one, except optional (nullish) fields are NOT in `required`,
 * matching how artifacts serialize (an absent cookQuantity is valid). The
 * strict model-facing schema above is unchanged.
 */
export function toConsumerJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema, false);
}

function convert(schema: z.ZodTypeAny, requireAll: boolean): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { $refStrategy: "none" }) as unknown;
  const fixed = strictify(raw, requireAll);
  if (typeof fixed !== "object" || fixed === null || Array.isArray(fixed)) {
    throw new Error("toResponseJsonSchema: top-level schema must be an object");
  }
  return fixed as Record<string, unknown>;
}

function strictify(node: unknown, requireAll: boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => strictify(item, requireAll));
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || key === "$ref" || key === "definitions") continue;
    if (key === "additionalProperties") continue; // re-applied below for objects
    // "required" is a list of names, never a schema; keep it verbatim.
    out[key] = key === "required" ? value : strictify(value, requireAll);
  }
  if ("const" in out) {
    const value = out.const;
    delete out.const;
    if (!("enum" in out)) out.enum = [value];
  }
  if (typeof out.properties === "object" && out.properties !== null) {
    out.additionalProperties = false;
    const names = Object.keys(out.properties as Record<string, unknown>);
    if (requireAll) {
      out.required = names;
    } else {
      // zod-to-json-schema already leaves optional fields out of required.
      const listed = Array.isArray(out.required) ? (out.required as string[]) : [];
      out.required = names.filter((name) => listed.includes(name));
    }
  }
  return out;
}
