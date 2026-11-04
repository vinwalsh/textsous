import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlogPost, { DEMO_BANNER, demoSiteMetadata } from "../src/app/demo-sites/[slug]/BlogPost";
import DemoSitesIndex from "../src/app/demo-sites/page";
import {
  DEMO_BLOGS,
  DEMO_SITES,
  DEMO_SITE_BYLINE,
  DEMO_SITE_SLUGS,
  blogFor,
  demoSiteBySlug,
  displayDuration,
  ingredientLines,
  isoDuration,
  type DemoSiteRecipe,
} from "../src/app/demo-sites/recipes";
import DemoPage from "../src/app/demo/page";
import DemoPost from "../src/app/embed-demo/DemoPost";
import { extractFromHtml } from "../src/lib/intake/url";

const ORIGIN = "https://open.textsous.com";

function render(recipe: DemoSiteRecipe, origin = ORIGIN): string {
  return renderToStaticMarkup(createElement(BlogPost, { recipe, origin }));
}

function jsonLdOf(html: string): Record<string, unknown> {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks).toHaveLength(1);
  return JSON.parse(blocks[0][1]) as Record<string, unknown>;
}

/** How React writes text into HTML. */
function escaped(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

describe("demo-site recipes", () => {
  it("are the four original posts, each on a blog whose name says Demo", () => {
    expect(DEMO_SITE_SLUGS).toEqual([
      "lemon-blueberry-muffins",
      "sheet-pan-chicken",
      "skillet-cornbread",
      "turkey-chili",
    ]);
    for (const blog of Object.values(DEMO_BLOGS)) expect(blog.name).toContain("Demo");
    expect(demoSiteBySlug("skillet-cornbread")?.title).toBe("Skillet Cornbread with Honey Butter");
    expect(demoSiteBySlug("nope")).toBeNull();
  });

  it("have the yields the demo scripts lean on", () => {
    expect(DEMO_SITES.map((recipe) => recipe.yield)).toEqual([
      "12 muffins",
      "4 servings",
      "8 servings",
      "6 servings",
    ]);
  });

  it("read like a blog: 2-3 intro paragraphs, steps, one or two notes", () => {
    for (const recipe of DEMO_SITES) {
      expect(recipe.intro.length, recipe.slug).toBeGreaterThanOrEqual(2);
      expect(recipe.intro.length, recipe.slug).toBeLessThanOrEqual(3);
      expect(recipe.steps.length, recipe.slug).toBeGreaterThanOrEqual(5);
      expect(recipe.notes.length, recipe.slug).toBeGreaterThanOrEqual(1);
      expect(recipe.notes.length, recipe.slug).toBeLessThanOrEqual(2);
      expect(recipe.totalMinutes, recipe.slug).toBeGreaterThanOrEqual(recipe.prepMinutes + recipe.cookMinutes);
    }
  });

  it("write amounts in the mixed styles real blogs use", () => {
    const lines = DEMO_SITES.flatMap(ingredientLines);
    expect(lines).toContain("1 and 3/4 cups (219g) all-purpose flour");
    expect(lines).toContain("3/4 cup (150g) granulated sugar");
    expect(lines.some((line) => line.startsWith("2 large eggs"))).toBe(true);
    expect(lines.some((line) => line.startsWith("a pinch of"))).toBe(true);
    expect(lines.some((line) => /^1 can \(\d+ oz \/ \d+g\)/.test(line))).toBe(true);
  });

  it("make no health or nutrition claims", () => {
    const text = JSON.stringify(DEMO_SITES) + JSON.stringify(DEMO_BLOGS);
    expect(text).not.toMatch(
      /\b(health|healthy|healthier|nutrition|nutritious|calories?|low-fat|guilt-free|superfood|detox|diet)\b/i,
    );
  });

  it("formats times as ISO 8601 and for the card", () => {
    expect(isoDuration(15)).toBe("PT15M");
    expect(isoDuration(60)).toBe("PT1H");
    expect(isoDuration(65)).toBe("PT1H5M");
    expect(displayDuration(22)).toBe("22 min");
    expect(displayDuration(60)).toBe("1 hr");
    expect(displayDuration(65)).toBe("1 hr 5 min");
  });
});

describe.each(DEMO_SITES.map((recipe) => [recipe.slug, recipe] as const))("/demo-sites/%s", (slug, recipe) => {
  const html = render(recipe);
  const pageUrl = `${ORIGIN}/demo-sites/${slug}`;

  it("has the Adjust with SOUS placement near the top and in the recipe card", () => {
    expect(html.match(/<div data-textsous-adjust=""><\/div>/g)).toHaveLength(2);
    const card = html.indexOf('id="recipe"');
    expect(card).toBeGreaterThan(-1);
    expect(html.indexOf("data-textsous-adjust")).toBeLessThan(card);
    expect(html.lastIndexOf("data-textsous-adjust")).toBeGreaterThan(card);
    expect(html).not.toContain("data-textsous-cook-along");
    expect(html).toContain('src="/embed.js"');
  });

  it("publishes valid schema.org Recipe JSON-LD built from the card's data", () => {
    const ld = jsonLdOf(html);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.name).toBe(recipe.title);
    expect(ld.url).toBe(pageUrl);
    expect(ld.author).toEqual({ "@type": "Organization", name: "TextSous Kitchen" });
    expect(ld.recipeYield).toBe(recipe.yield);
    expect(ld.prepTime).toBe(isoDuration(recipe.prepMinutes));
    expect(ld.cookTime).toBe(isoDuration(recipe.cookMinutes));
    expect(ld.totalTime).toBe(isoDuration(recipe.totalMinutes));
    for (const key of ["prepTime", "cookTime", "totalTime"]) expect(ld[key]).toMatch(/^PT(\d+H)?(\d+M)?$/);
    expect(ld.recipeIngredient).toEqual(ingredientLines(recipe));
    expect(ld.recipeInstructions).toEqual(recipe.steps.map((text) => ({ "@type": "HowToStep", text })));
    expect(ld).not.toHaveProperty("nutrition");
  });

  it("is read by the converter's own intake as one recipe", () => {
    const extracted = extractFromHtml(html, pageUrl);
    expect(extracted.hasJsonLd).toBe(true);
    expect(extracted.title).toBe(recipe.title);
    expect(extracted.author).toBe("TextSous Kitchen");
    expect(extracted.servingsRaw).toBe(recipe.yield);
    expect(extracted.ingredientLines).toEqual(ingredientLines(recipe));
    expect(extracted.instructionLines).toEqual([...recipe.steps]);
    expect(extracted.jsonLd?.totalTime).toBe(isoDuration(recipe.totalMinutes));
  });

  it("sets its canonical link and site name for this origin", () => {
    const meta = demoSiteMetadata(recipe, ORIGIN);
    expect(meta.alternates?.canonical).toBe(pageUrl);
    expect(meta.openGraph?.siteName).toBe(blogFor(recipe).name);
    expect(String(meta.title)).toContain(blogFor(recipe).name);
    const preview = "https://open-textsous-git-x.vercel.app";
    expect(demoSiteMetadata(recipe, preview).alternates?.canonical).toBe(`${preview}/demo-sites/${slug}`);
  });

  it("opens with the demo banner and a link back to the demo blogs", () => {
    expect(DEMO_BANNER).toBe("Demo: a pretend recipe blog with the TextSous button");
    const banner = html.indexOf(DEMO_BANNER);
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(html.indexOf("<header"));
    expect(html).toMatch(new RegExp(`${DEMO_BANNER}\\. <a href="/demo-sites">All demo blogs</a>`));
  });

  it("looks like a third-party blog: its own name, no TextSous header or footer", () => {
    expect(html).toContain('class="ts-demo-site-root ');
    expect(html).not.toContain("site-header");
    expect(html).not.toContain("site-footer");
    expect(html).toContain(escaped(blogFor(recipe).name));
    expect(html).toContain(DEMO_SITE_BYLINE);
  });

  it("has a Jump to recipe link and the whole recipe card", () => {
    expect(html).toMatch(/<a class="[^"]+" href="#recipe">Jump to recipe<\/a>/);
    for (const line of [...recipe.intro, ...ingredientLines(recipe), ...recipe.steps, ...recipe.notes]) {
      expect(html, line).toContain(escaped(line));
    }
    for (const group of recipe.ingredients) if (group.heading) expect(html).toContain(escaped(group.heading));
    expect(html).toContain(escaped(recipe.yield));
    expect(html).toContain(displayDuration(recipe.totalMinutes));
    expect(html).toContain('href="https://creativecommons.org/publicdomain/zero/1.0/"');
  });

  it("draws its hero with inline shapes, never an image", () => {
    expect(html).not.toMatch(/<img\b/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("tells testers that only production converts it", () => {
    expect(html).not.toContain("data-demo-test-note");
    expect(render(recipe, "http://localhost:3102")).toContain("data-demo-test-note");
  });
});

describe("demo-site chrome", () => {
  it("hides the TextSous header and footer on the blog pages only", () => {
    const css = readFileSync("src/app/demo-sites/[slug]/blog-chrome.css", "utf8");
    expect(css).toMatch(
      /body:has\(\.ts-demo-site-root\) > \.site-header,\nbody:has\(\.ts-demo-site-root\) > header,\nbody:has\(\.ts-demo-site-root\) > \.site-footer \{\n {2}display: none;\n\}/,
    );
    const page = readFileSync("src/app/demo-sites/[slug]/page.tsx", "utf8");
    expect(page).toContain('import "./blog-chrome.css";');
    expect(renderToStaticMarkup(createElement(DemoSitesIndex))).not.toContain("ts-demo-site-root");
  });
});

describe("/demo-sites index", () => {
  const html = renderToStaticMarkup(createElement(DemoSitesIndex));

  it("lists the four demo blogs as full page loads", () => {
    const links = [...html.matchAll(/<a href="(\/demo-sites\/[^"]+)">/g)].map((m) => m[1]);
    expect(links).toEqual(DEMO_SITE_SLUGS.map((slug) => `/demo-sites/${slug}`));
    for (const recipe of DEMO_SITES) expect(html).toContain(escaped(recipe.title));
    expect(html).toContain("Adjust with SOUS");
  });

  it("is linked from /demo and from /embed-demo", () => {
    expect(renderToStaticMarkup(createElement(DemoPage))).toContain('href="/demo-sites"');
    const post = renderToStaticMarkup(createElement(DemoPost, { origin: ORIGIN, src: null, autoOpen: false }));
    expect(post).toContain(`<a href="${ORIGIN}/demo-sites">`);
  });
});
