import type { Metadata } from "next";
import Link from "next/link";
import { DEMO_SITES, blogFor } from "./recipes";

export const metadata: Metadata = {
  title: "Demo recipe blogs · TextSous Open",
  description: "Four pretend recipe blogs with the Adjust with SOUS button.",
};

/** The four pretend recipe blogs (TextSous chrome stays on this page). */
export default function DemoSitesIndex() {
  return (
    <main>
      <h1>Demo recipe blogs</h1>
      <p className="tagline">
        Four pretend recipe blogs with the Adjust with SOUS button. Open one and tap the button to
        change the servings, make the recipe dairy-free or vegan, give it a new cuisine, or cook along
        step by step. Everything shows up right on the blog&apos;s page.
      </p>
      <ul className="card demo-list">
        {DEMO_SITES.map((recipe) => (
          <li key={recipe.slug}>
            {/* A full page load, so each blog runs its own copy of embed.js. */}
            <a href={`/demo-sites/${recipe.slug}`}>
              <span className="demo-host">{recipe.title}</span>
              <span className="demo-slug">
                {blogFor(recipe).name} · {recipe.yield}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="meta">
        The blogs are made up for this demo, and the recipes were written for it (CC0). Have a recipe
        site? See the <Link href="/embed-demo">Cook Along button on a demo blog post</Link>.
      </p>
      <p className="meta">
        <Link href="/demo">Back to the demo recipes</Link>
      </p>
    </main>
  );
}
