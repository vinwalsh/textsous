import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DemoPost, { EMBED_SNIPPET, demoSrc } from "../src/app/embed-demo/DemoPost";
import { DEMO_FIXTURE, DEMO_RECIPE, demoJsonLd } from "../src/app/embed-demo/recipe";

describe("embed demo recipe", () => {
  const fixture = readFileSync(DEMO_FIXTURE, "utf8");

  it("is an original CC0 fixture", () => {
    expect(fixture).toContain("Original fixture recipe written for TextSous. CC0-1.0.");
  });

  it("matches the fixture word for word", () => {
    expect(fixture).toContain(DEMO_RECIPE.title);
    expect(fixture).toContain(DEMO_RECIPE.intro);
    expect(fixture).toContain(DEMO_RECIPE.author);
    for (const line of DEMO_RECIPE.ingredients) expect(fixture).toContain(`"${line}"`);
    for (const section of DEMO_RECIPE.sections) {
      for (const step of section.steps) expect(fixture).toContain(step);
    }
  });

  it("publishes schema.org Recipe JSON-LD", () => {
    const ld = demoJsonLd("https://open.textsous.com/embed-demo");
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.recipeIngredient).toHaveLength(DEMO_RECIPE.ingredients.length);
    const steps = JSON.stringify(ld.recipeInstructions);
    expect(steps).toContain("HowToSection");
    expect(steps.match(/HowToStep/g)).toHaveLength(5);
    expect(ld).not.toHaveProperty("nutrition");
  });
});

describe("embed demo page", () => {
  it("is labeled as a demo, carries JSON-LD, the snippet and the placement", () => {
    const html = renderToString(
      createElement(DemoPost, { origin: "https://open.textsous.com", src: null, autoOpen: false }),
    );
    expect(html).toContain("Demo page.");
    expect(html).toContain("original written for this project");
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("data-textsous-cook-along");
    expect(html).not.toContain("data-autoopen");
    expect(html).toContain("&lt;script src=&quot;https://open.textsous.com/embed.js&quot; async&gt;");
    expect(html).toContain('src="/embed.js"');
    expect(EMBED_SNIPPET).toContain("<div data-textsous-cook-along></div>");
  });

  it("passes data-src and data-autoopen through for screenshots", () => {
    const html = renderToString(
      createElement(DemoPost, {
        origin: "http://localhost:3102",
        src: "http://localhost:3102/api/artifact/abc?sig=def",
        autoOpen: true,
      }),
    );
    expect(html).toContain('data-src="http://localhost:3102/api/artifact/abc?sig=def"');
    expect(html).toContain('data-autoopen=""');
  });

  it("accepts only this site's artifact links as data-src", () => {
    const origin = "https://open.textsous.com";
    expect(demoSrc("/api/artifact/abc?sig=1", origin)).toBe(`${origin}/api/artifact/abc?sig=1`);
    expect(demoSrc("https://evil.test/api/artifact/abc", origin)).toBeNull();
    expect(demoSrc(`${origin}/elsewhere.json`, origin)).toBeNull();
    expect(demoSrc(undefined, origin)).toBeNull();
  });
});
