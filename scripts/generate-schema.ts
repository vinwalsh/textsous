import { mkdirSync, writeFileSync } from "node:fs";
import { CookAlongArtifactSchema } from "../src/lib/schema/artifact";
import { CanonicalRecipeSchema } from "../src/lib/schema/canonical";
import { TimelineDefinitionSchema } from "../src/lib/schema/timeline";
import { toResponseJsonSchema } from "../src/lib/schema/json";

// Regenerates docs/schema/*.json from the zod schemas. Run after any schema
// change and keep the output committed: textsous.com validates against it.
mkdirSync("docs/schema", { recursive: true });

const schemas: Record<string, unknown> = {
  canonical: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "TextSous canonical recipe v1",
    ...toResponseJsonSchema(CanonicalRecipeSchema),
  },
  timeline: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "TextSous timeline definition v1",
    ...toResponseJsonSchema(TimelineDefinitionSchema),
  },
  artifact: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "TextSous Cook Along artifact v1",
    ...toResponseJsonSchema(CookAlongArtifactSchema),
  },
};

for (const [name, schema] of Object.entries(schemas)) {
  writeFileSync(`docs/schema/${name}.json`, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote docs/schema/${name}.json`);
}
