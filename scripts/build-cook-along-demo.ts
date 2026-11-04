import { writeFileSync } from "node:fs";
import { fixtureArtifact } from "../tests/helpers/fixture-artifact";

// Writes the /cook-along-demo artifact: the toasted oat porridge fixture
// (eval/fixtures, a recipe written for this repo) compiled offline from its
// recorded procedure, so the page needs no model call. Deterministic;
// tests/cook-along-demo.test.ts fails when the committed copy is stale.
// Run: npx tsx scripts/build-cook-along-demo.ts

const OUT = "src/app/cook-along-demo/artifact.json";
writeFileSync(OUT, `${JSON.stringify(fixtureArtifact("toasted-oat-porridge"), null, 2)}\n`);
console.log(`wrote ${OUT}`);
