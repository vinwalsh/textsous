import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../src/app/layout";
import NotFound from "../src/app/not-found";
import SiteFooter, { LICENSE_URL, PRIVACY_URL } from "../src/app/SiteFooter";
import SiteHeader, { GITHUB_URL } from "../src/app/SiteHeader";

function layoutHtml(): string {
  return renderToStaticMarkup(createElement(RootLayout, null, createElement("main", null, "page")));
}

describe("site header", () => {
  const html = renderToStaticMarkup(createElement(SiteHeader));

  it("shows the TextSous wordmark with the Open pill, linking home", () => {
    expect(html).toMatch(
      /<a [^>]*href="\/"[^>]*><span class="wordmark">TextSous<\/span> <span class="open-pill">Open<\/span><\/a>/,
    );
  });

  it("links Demo, Use in your assistant and GitHub", () => {
    expect(html).toContain('<a href="/demo">Demo</a>');
    expect(html).toContain('<a href="/assistants">Use in your assistant</a>');
    expect(GITHUB_URL).toBe("https://github.com/vinwalsh/textsous");
    expect(html).toContain(`<a href="${GITHUB_URL}">GitHub</a>`);
    expect(html).toContain('<nav class="site-nav" aria-label="Site">');
  });

  it("has one warm line of intro and no hype", () => {
    expect(html).toContain("Turn any recipe into a calm, step-by-step cook along.");
    expect(html).not.toMatch(/magic/i);
  });
});

describe("site footer", () => {
  const html = renderToStaticMarkup(createElement(SiteFooter));

  it("names the license and company, and links privacy and takedowns", () => {
    expect(html).toContain(`<a href="${LICENSE_URL}">Open source (MIT)</a> by SOUS AI LLC`);
    expect(LICENSE_URL).toBe("https://github.com/vinwalsh/textsous/blob/main/LICENSE");
    expect(html).toContain(`<a href="${PRIVACY_URL}">Privacy</a>`);
    expect(PRIVACY_URL).toBe("https://textsous.com/privacy");
    expect(html).toMatch(/<a href="mailto:privacy@textsous.com"[^>]*>Takedowns<\/a>/);
  });

  it("keeps the privacy note", () => {
    expect(html).toContain("Converted recipes are private to you");
    expect(html).toContain("photos are processed in memory and never stored");
  });
});

describe("layout chrome", () => {
  it("puts the header and footer directly in <body>, around the page", () => {
    const html = layoutHtml();
    expect(html).toMatch(/<body><header class="site-header">/);
    expect(html).toMatch(/<\/header><main>page<\/main><footer class="site-footer">/);
    expect(html).toMatch(/<\/footer><\/body>/);
  });

  it("loads Inter for UI text and Fredoka for the wordmark as CSS variables", () => {
    expect(layoutHtml()).toMatch(/<html lang="en" class="test-font-inter-variable test-font-fredoka-variable">/);
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/body \{[^}]*font-family: var\(--font-inter/);
    expect(css).toMatch(/\.wordmark \{[^}]*font-family: var\(--font-fredoka/);
  });

  it("stays hidden inside the /embed overlay", () => {
    const css = readFileSync("src/app/embed/embed-chrome.css", "utf8");
    expect(css).toContain("body:has(.ts-embed-root) > .site-header");
    expect(css).toContain("body:has(.ts-embed-root) > .site-footer");
  });
});

describe("embed.js chrome", () => {
  const code = readFileSync("public/embed.js", "utf8");

  it("uses the TextSous colors and the Inter-then-system font stack", () => {
    expect(code).toContain('var FONT = "Inter,system-ui,');
    expect(code).toContain("background:#B74725;color:#fff");
    expect(code).toContain("button:hover{background:#9D3D20}");
    expect(code).toContain("outline:2px solid #D45A35;outline-offset:2px");
    expect(code).not.toContain("BlinkMacSystemFont");
  });
});

describe("not found page", () => {
  it("stays light and offers a way back", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("We can&#x27;t find that page");
    expect(html).toContain('<a class="btn btn-primary" href="/">Convert a recipe</a>');
    expect(html).toContain('<a class="btn" href="/demo">Try a demo recipe</a>');
  });
});
