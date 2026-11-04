import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bookmarkletCode, bookmarkletHref, bookmarkletScriptUrl } from "../src/app/embed-demo/Bookmarklet";
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

  it("tells testers that plain /embed-demo converts only on production", () => {
    const render = (origin: string, src: string | null) =>
      renderToString(createElement(DemoPost, { origin, src, autoOpen: false }));
    expect(render("http://localhost:3102", null)).toContain("data-demo-test-note");
    expect(render("https://open-textsous-git-x.vercel.app", null)).toContain("autoopen=1");
    expect(render("https://open.textsous.com", null)).not.toContain("data-demo-test-note");
    expect(render("http://localhost:3102", "http://localhost:3102/api/artifact/a?sig=b")).not.toContain(
      "data-demo-test-note",
    );
  });

  it("accepts only this site's artifact links as data-src", () => {
    const origin = "https://open.textsous.com";
    expect(demoSrc("/api/artifact/abc?sig=1", origin)).toBe(`${origin}/api/artifact/abc?sig=1`);
    expect(demoSrc("https://evil.test/api/artifact/abc", origin)).toBeNull();
    expect(demoSrc(`${origin}/elsewhere.json`, origin)).toBeNull();
    expect(demoSrc(undefined, origin)).toBeNull();
  });
});

describe("embed demo bookmarklet", () => {
  const scriptUrl = "https://open.textsous.com/embed.js";

  /** Runs the bookmarklet against a stand-in document and returns the scripts it added. */
  function run(code: string, floating = false) {
    const added: Array<{ src?: string; async?: boolean; attrs: Record<string, string> }> = [];
    const document = {
      querySelector: (selector: string) => (selector === "[data-textsous-floating]" && floating ? {} : null),
      createElement: () => {
        const el = { attrs: {} as Record<string, string>, setAttribute: (k: string, v: string) => (el.attrs[k] = v) };
        return el;
      },
      body: { appendChild: (el: { attrs: Record<string, string> }) => added.push(el) },
      documentElement: {},
    };
    runInNewContext(code, { document });
    return added;
  }

  it("has its own section on the demo post, with no javascript: address in the server HTML", () => {
    const html = renderToString(
      createElement(DemoPost, { origin: "https://open.textsous.com", src: null, autoOpen: false }),
    );
    expect(html).toContain("Try it on any recipe page");
    expect(html).toContain("data-bookmarklet-section");
    expect(html).toContain("bookmarks bar");
    expect(html).toContain("Some sites block outside scripts");
    expect(html).not.toContain("javascript:");
  });

  it("loads this site's own embed.js", () => {
    expect(bookmarkletScriptUrl("https://open.textsous.com")).toBe(scriptUrl);
    expect(bookmarkletScriptUrl("https://open-textsous-git-x.vercel.app/")).toBe(
      "https://open-textsous-git-x.vercel.app/embed.js",
    );
  });

  it("adds embed.js with data-floating and data-mode=adjust, once", () => {
    const added = run(bookmarkletCode(scriptUrl));
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(scriptUrl);
    expect(added[0].async).toBe(true);
    expect(added[0].attrs).toEqual({ "data-floating": "", "data-mode": "adjust" });
    expect(run(bookmarkletCode(scriptUrl), true)).toHaveLength(0);
  });

  it("is a percent-encoded javascript: link that decodes to that code", () => {
    const href = bookmarkletHref(scriptUrl);
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).not.toMatch(/[\s"#{}]/);
    expect(decodeURIComponent(href.slice("javascript:".length))).toBe(bookmarkletCode(scriptUrl));
  });
});
