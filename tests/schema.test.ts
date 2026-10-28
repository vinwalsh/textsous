import { describe, expect, it } from "vitest";
import {
  CanonicalRecipeSchema,
  canonicalResponseJsonSchema,
} from "../src/lib/schema/canonical";

describe("canonical response JSON schema", () => {
  it("is inlined, strict, and fully required", () => {
    const schema = canonicalResponseJsonSchema();
    const text = JSON.stringify(schema);
    expect(text).not.toContain("$ref");
    expect(text).not.toContain("$schema");
    expect(text).not.toContain('"const"');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "version",
        "id",
        "title",
        "source",
        "nativeServings",
        "ingredients",
        "steps",
        "equipment",
        "sourceFingerprint",
      ]),
    );
  });

  it("accepts a minimal valid recipe", () => {
    const parsed = CanonicalRecipeSchema.safeParse({
      version: 1,
      id: "rcp-1",
      title: "Toast",
      source: { kind: "text" },
      nativeServings: 1,
      ingredients: [
        { id: "ing-1", name: "bread", quantity: "1", unit: "slice", allergens: [], allergenTraces: [] },
      ],
      steps: [{ id: "step-1", kind: "active", text: "Toast the bread." }],
      equipment: [],
      sourceFingerprint: "sha256:x",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const parsed = CanonicalRecipeSchema.safeParse({
      version: 1,
      id: "rcp-1",
      title: "Toast",
      source: { kind: "text" },
      nativeServings: 1,
      ingredients: [
        {
          id: "ing-1",
          name: "bread",
          quantity: "1",
          unit: "slice",
          allergens: [],
          allergenTraces: [],
          calories: 100,
        },
      ],
      steps: [{ id: "step-1", kind: "active", text: "Toast the bread." }],
      equipment: [],
      sourceFingerprint: "sha256:x",
    });
    expect(parsed.success).toBe(false);
  });
});
