import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StructuredChatClient } from "../src/lib/model/structured";
import { canonicalize, CANONICALIZE_MAX_CHARS } from "../src/lib/stages/canonicalize";
import { extractFromText, MAX_TEXT_CHARS } from "../src/lib/intake/text";
import { extractFromHtml, MAX_RAW_TEXT_CHARS } from "../src/lib/intake/url";

const RECIPE = {
  version: 1,
  id: "x",
  title: "Long Soup",
  source: { kind: "text", url: null, site: null, author: null, book: null, page: null, license: null },
  cuisine: null,
  nativeServings: 2,
  servingsLarge: null,
  scalingNotes: null,
  ingredients: [
    {
      id: "i",
      name: "water",
      quantity: "1",
      unit: "cup",
      quantity4: null,
      scaleRule: null,
      cookQuantity: null,
      buyQuantity: null,
      allergens: [],
      allergenTraces: [],
      note: null,
    },
  ],
  steps: [{ id: "s", kind: "active", text: "Boil the water." }],
  equipment: [],
  sourceFingerprint: "x",
};

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

function capture(seen: string[]): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params) => {
          seen.push(params.messages.map((m) => String(m.content)).join("\n"));
          return {
            choices: [{ message: { content: JSON.stringify(RECIPE) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
}

describe("canonicalize input window", () => {
  it("is 60,000 characters, matching the paste limit and the page text cap", () => {
    expect(CANONICALIZE_MAX_CHARS).toBe(60_000);
    expect(MAX_TEXT_CHARS).toBe(60_000);
    expect(MAX_RAW_TEXT_CHARS).toBe(60_000);
  });

  it("sends text up to the window whole, with no warning", async () => {
    const seen: string[] = [];
    const rawText = `Water soup. ${"a".repeat(30_000)} END-MARKER`;
    const result = await canonicalize(
      { source: { kind: "text" }, rawText, ingredientLines: [], instructionLines: [], hasJsonLd: false },
      { client: capture(seen) },
    );
    expect(seen[0]).toContain("END-MARKER");
    expect(seen[0]).not.toContain("[truncated]");
    expect(result.warnings).toEqual([]);
  });

  it("cuts longer text at the window and records a warning", async () => {
    const seen: string[] = [];
    const rawText = `${"b".repeat(CANONICALIZE_MAX_CHARS)}TAIL-MARKER`;
    const result = await canonicalize(
      { source: { kind: "text" }, rawText, ingredientLines: [], instructionLines: [], hasJsonLd: false },
      { client: capture(seen) },
    );
    expect(seen[0]).toContain("[truncated]");
    expect(seen[0]).not.toContain("TAIL-MARKER");
    expect(result.warnings[0]).toMatch(/only the first 60,000 were read/);
  });
});

describe("pasted text limit", () => {
  it("refuses text over 60,000 characters with a clear message", () => {
    expect(() => extractFromText("x".repeat(60_001))).toThrow(
      /too long \(60,001 characters; the limit is 60,000\)/,
    );
    expect(extractFromText("x".repeat(60_000)).rawText).toHaveLength(60_000);
  });
});

describe("URL page text fallback", () => {
  it("keeps the first 60,000 characters and records a warning", () => {
    const html = `<html><body><article>${"word ".repeat(15_000)}</article></body></html>`;
    const extracted = extractFromHtml(html, "https://example.com/long");
    expect(extracted.rawText.length).toBe(60_000);
    expect(extracted.warnings[0]).toMatch(/only the first 60,000 were kept/);
  });

  it("records no warning for a normal page", () => {
    const extracted = extractFromHtml(
      "<html><body><article>Short recipe.</article></body></html>",
      "https://example.com/short",
    );
    expect(extracted.warnings).toEqual([]);
  });
});
