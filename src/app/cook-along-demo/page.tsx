import type { Metadata } from "next";
import Link from "next/link";
import { CookAlongArtifactSchema } from "../../lib/schema/artifact";
import artifactJson from "./artifact.json";
import DemoCookAlong from "./DemoCookAlong";

export const metadata: Metadata = {
  title: "Cook Along demo · TextSous Open",
  description:
    "A finished TextSous cook along that opens instantly: component lanes, a guided timeline and step cards with timers.",
};

/**
 * A finished cook along with no conversion and no model call: the toasted
 * oat porridge fixture (written for this repo), built by
 * scripts/build-cook-along-demo.ts.
 */
export default function CookAlongDemoPage() {
  const artifact = CookAlongArtifactSchema.parse(artifactJson);
  return (
    <main>
      <h1>Cook Along demo</h1>
      <p className="tagline">
        A finished cook along you can open right away. Each component of the meal gets its own lane,
        the guided timeline runs from Mise en Place to serving, and every step card opens with details
        and a timer. Press Cook to follow along.
      </p>
      <DemoCookAlong artifact={artifact} />
      <p className="meta">
        <Link href="/demo">More demo recipes</Link> · <Link href="/">Convert your own recipe</Link>
      </p>
    </main>
  );
}
