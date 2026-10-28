import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFromHtml, normalizeUrl } from "../src/lib/intake/url";

const jsonLdHtml = readFileSync("eval/fixtures/toasted-oat-porridge.html", "utf8");
const plainHtml = readFileSync("eval/fixtures/charred-corn-salad.html", "utf8");

describe("extractFromHtml", () => {
  it("extracts a JSON-LD recipe with HowToSection nesting", () => {
    const result = extractFromHtml(jsonLdHtml, "https://example.com/toasted-oat-porridge");
    expect(result.hasJsonLd).toBe(true);
    expect(result.title).toBe("Toasted Oat Porridge with Brown Butter Apples");
    expect(result.ingredientLines).toHaveLength(7);
    expect(result.ingredientLines[0]).toBe("1 cup rolled oats");
    expect(result.servingsRaw).toBe("2 servings");
    expect(result.author).toBe("TextSous Kitchen");
    expect(result.site).toBe("TextSous Fixtures");
    expect(result.canonicalUrl).toBe("https://example.com/recipes/toasted-oat-porridge");
    expect(result.instructionLines).toHaveLength(5);
    expect(result.instructionLines.filter((l) => l.startsWith("[Apples]"))).toHaveLength(2);
  });

  it("finds recipes inside @graph arrays", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "page" },
          {
            "@type": "Recipe",
            name: "Graph Soup",
            recipeIngredient: ["1 onion"],
            recipeInstructions: "Simmer the onion.",
            recipeYield: 4,
          },
        ],
      })}</script>
      </head><body></body></html>`;
    const result = extractFromHtml(html, "https://example.com/graph-soup");
    expect(result.hasJsonLd).toBe(true);
    expect(result.title).toBe("Graph Soup");
    expect(result.ingredientLines).toEqual(["1 onion"]);
    expect(result.instructionLines).toEqual(["Simmer the onion."]);
    expect(result.servingsRaw).toBe("4");
  });

  it("refuses pages with several recipes", () => {
    const extra = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Second Recipe",
    })}</script>`;
    const multi = jsonLdHtml.replace("</head>", `${extra}</head>`);
    expect(() => extractFromHtml(multi, "https://example.com/x")).toThrow(
      /single-recipe pages only/,
    );
  });

  it("falls back to readable text without JSON-LD", () => {
    const result = extractFromHtml(plainHtml, "https://example.com/charred-corn-salad");
    expect(result.hasJsonLd).toBe(false);
    expect(result.title).toContain("Charred Corn and Lime Salad");
    expect(result.site).toBe("TextSous Fixtures");
    expect(result.author).toBe("TextSous Kitchen");
    expect(result.canonicalUrl).toBe("https://example.com/recipes/charred-corn-salad");
    expect(result.rawText).toContain("Char on a hot grill");
    expect(result.rawText).toContain("lime");
    expect(result.rawText).not.toContain("<");
    expect(result.rawText).not.toContain("Home | Recipes");
  });
});

describe("normalizeUrl", () => {
  it("lowercases the host and strips tracking params and fragments", () => {
    expect(normalizeUrl("https://Example.com/r?utm_source=x&b=2#frag")).toBe(
      "https://example.com/r?b=2",
    );
  });
});
