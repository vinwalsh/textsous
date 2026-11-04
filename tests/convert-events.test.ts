import { describe, expect, it } from "vitest";
import {
  encodeEvent,
  factsFromJsonLd,
  mergeFacts,
  parseIsoMinutes,
  readEvents,
  type ConvertEvent,
  type RecipeFacts,
} from "../src/lib/convert-events";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ConvertEvent[]> {
  const events: ConvertEvent[] = [];
  for await (const event of readEvents(body)) events.push(event);
  return events;
}

describe("convert events (NDJSON)", () => {
  it("round-trips events split anywhere across chunks", async () => {
    const events: ConvertEvent[] = [
      { type: "overview", overview: { summary: "Roast, then glaze.", components: [{ name: "Glaze", how: "Whisk and simmer." }] } },
      { type: "error", status: 503, error: "That took too long." },
    ];
    const [first, second] = events.map(encodeEvent);
    // Chunks cut mid-line, plus a blank line between the two events.
    const text = `${first}\n${second}`;
    const cut = [text.slice(0, 7), text.slice(7, 60), text.slice(60, first.length + 3), text.slice(first.length + 3)];
    expect(await collect(streamOf(cut))).toEqual(events);
  });

  it("skips blank lines, reads a last line without a newline, and rejects junk", async () => {
    const line = JSON.stringify({ type: "error", status: 422, error: "x" });
    expect(await collect(streamOf(["\n\n", line]))).toHaveLength(1);
    await expect(collect(streamOf(["[1,2]\n"]))).rejects.toThrow(/Not a conversion event/);
  });
});

describe("facts", () => {
  it("reads ISO 8601 durations as minutes", () => {
    expect(parseIsoMinutes("PT1H30M")).toBe(90);
    expect(parseIsoMinutes("P0DT0H45M")).toBe(45);
    expect(parseIsoMinutes("PT90S")).toBe(2);
    expect(parseIsoMinutes("PT0M")).toBeNull();
    expect(parseIsoMinutes("PT")).toBeNull();
    expect(parseIsoMinutes("about an hour")).toBeNull();
    expect(parseIsoMinutes(undefined)).toBeNull();
  });

  it("builds facts from a page's schema.org Recipe with no model call", () => {
    const facts = factsFromJsonLd(
      {
        name: " Blueberry Muffins ",
        author: "Sam",
        recipeYield: "12 muffins",
        prepTime: "PT15M",
        cookTime: "PT25M",
        recipeIngredient: ["2 cups all-purpose flour", "1 cup whole milk", "2 large eggs", "1 cup blueberries"],
        recipeInstructions: ["Mix.", "Bake."],
      },
      { url: "https://example.com/muffins", site: "example.com" },
    );
    expect(facts).toMatchObject({
      title: "Blueberry Muffins",
      servingsText: "12 muffins",
      ingredientCount: 4,
      minutes: { prep: 15, cook: 25, total: 40 },
      source: { kind: "url", url: "https://example.com/muffins", site: "example.com", author: "Sam" },
    });
    expect(facts.allergens).toEqual(expect.arrayContaining(["gluten", "milk", "egg"]));
  });

  it("merges facts: newer known values win, the posted yield stays, allergens only grow", () => {
    const early: RecipeFacts = {
      title: "Muffins",
      source: { kind: "url", url: "https://example.com/m", site: "example.com", author: null },
      servingsText: "12 muffins",
      ingredientCount: 9,
      minutes: { prep: 15, cook: 25, total: 40 },
      allergens: ["gluten"],
      traces: ["nuts"],
    };
    const later: RecipeFacts = {
      title: "Blueberry Muffins",
      source: { kind: "url", url: null, site: null, author: "Sam" },
      servingsText: "12",
      ingredientCount: 10,
      minutes: { prep: null, cook: null, total: null },
      allergens: ["milk", "nuts"],
      traces: [],
    };
    expect(mergeFacts(early, later)).toEqual({
      title: "Blueberry Muffins",
      source: { kind: "url", url: "https://example.com/m", site: "example.com", author: "Sam" },
      servingsText: "12 muffins",
      ingredientCount: 10,
      minutes: { prep: 15, cook: 25, total: 40 },
      allergens: ["gluten", "milk", "nuts"],
      traces: [],
    });
  });
});
