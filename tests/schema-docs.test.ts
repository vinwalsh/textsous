import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CookAlongArtifactSchema } from "../src/lib/schema/artifact";
import { CanonicalRecipeSchema } from "../src/lib/schema/canonical";
import { TimelineDefinitionSchema } from "../src/lib/schema/timeline";
import { VariantTransformSchema } from "../src/lib/schema/variant";
import { toConsumerJsonSchema, toResponseJsonSchema } from "../src/lib/schema/json";

type Node = { properties?: Record<string, Node>; items?: Node; required?: string[] };

function ingredientNode(schema: Node): Node {
  return schema.properties!.recipe.properties!.ingredients.items!;
}

describe("published JSON Schemas (docs/schema)", () => {
  const published = JSON.parse(readFileSync("docs/schema/artifact.json", "utf8")) as Node;

  it("list nullish fields as optional, as artifacts serialize them", () => {
    const required = ingredientNode(published).required ?? [];
    expect(required).not.toContain("cookQuantity");
    expect(required).not.toContain("buyQuantity");
    expect(required).not.toContain("note");
    expect(required).toEqual(
      expect.arrayContaining(["id", "name", "quantity", "unit", "allergens", "allergenTraces"]),
    );
    expect(published.properties!.recipe.required).not.toContain("nativeServings");
  });

  it("validate an artifact with absent optional fields (no cookQuantity)", () => {
    const required = ingredientNode(published).required ?? [];
    const serialized = { id: "ing-1", name: "flour", quantity: "1", unit: "cup", allergens: [], allergenTraces: [] };
    expect(required.every((key) => key in serialized)).toBe(true);
  });

  it("match a fresh generation (CI diffs the committed copies)", () => {
    const fresh: Record<string, unknown> = {
      canonical: CanonicalRecipeSchema,
      timeline: TimelineDefinitionSchema,
      artifact: CookAlongArtifactSchema,
      variant: VariantTransformSchema,
    };
    for (const [name, schema] of Object.entries(fresh)) {
      const committed = JSON.parse(readFileSync(`docs/schema/${name}.json`, "utf8")) as Record<string, unknown>;
      const { $schema: _s, title: _t, ...rest } = committed;
      void _s;
      void _t;
      expect(rest).toEqual(toConsumerJsonSchema(schema as never));
    }
  });

  it("keeps the strict model-facing schema requiring every field", () => {
    const strict = toResponseJsonSchema(CookAlongArtifactSchema) as Node;
    expect(ingredientNode(strict).required).toEqual(
      expect.arrayContaining(["cookQuantity", "buyQuantity", "note", "quantity4", "scaleRule"]),
    );
  });
});
