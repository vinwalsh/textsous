import { describe, expect, it } from "vitest";
import {
  CuisineVariantTransformSchema,
  cuisineResponseJsonSchema,
  DietaryVariantTransformSchema,
  dietaryResponseJsonSchema,
} from "../src/lib/schema/variant";

function violations(schema: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.type === "object" || rec.properties) {
      if (rec.additionalProperties !== false) found.push(`${path}: additionalProperties`);
      const props = Object.keys((rec.properties as object) ?? {});
      const req = (rec.required as string[]) ?? [];
      if (!props.every((p) => req.includes(p))) found.push(`${path}: required`);
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "required") continue;
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`));
      else walk(v, `${path}.${k}`);
    }
  };
  walk(schema, "$");
  return found;
}

function expectEmittedSchema(label: string, schema: Record<string, unknown>): void {
  const text = JSON.stringify(schema);
  expect(text, `${label}: no $ref`).not.toContain("$ref");
  expect(violations(schema), `${label}: strict`).toEqual([]);
}

const MIN_DIETARY = {
  kind: "dietary",
  target: "dairy-free",
  titleOverride: null,
  swaps: [
    {
      fromIngredientId: "ing-1",
      to: { name: "oat milk", quantity: "1", unit: "cup" },
      omitReason: null,
      reason: "oat milk replaces milk one to one",
      packageRequirements: ["certified dairy-free facility"],
    },
  ],
  stepOverrides: [{ stepId: "step-1", text: "Add the oat milk." }],
  techniqueChanges: [],
  rationale: ["one swap removes all dairy"],
};

describe("variant response JSON schemas", () => {
  it("emits strict dietary and cuisine schemas", () => {
    expectEmittedSchema("dietary", dietaryResponseJsonSchema());
    expectEmittedSchema("cuisine", cuisineResponseJsonSchema());
  });

  it("accepts a minimal dietary transform", () => {
    expect(DietaryVariantTransformSchema.safeParse(MIN_DIETARY).success).toBe(true);
  });

  it("rejects bad targets, bad kinds and unknown keys", () => {
    expect(
      DietaryVariantTransformSchema.safeParse({ ...MIN_DIETARY, target: "keto" }).success,
    ).toBe(false);
    expect(
      CuisineVariantTransformSchema.safeParse({ ...MIN_DIETARY, kind: "cuisine", target: "Thai" })
        .success,
    ).toBe(true);
    expect(
      DietaryVariantTransformSchema.safeParse({ ...MIN_DIETARY, calories: 100 }).success,
    ).toBe(false);
  });
});
