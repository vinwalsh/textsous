import { describe, expect, it } from "vitest";
import {
  adjustLine,
  buildEmbedUrl,
  embeddingOrigin,
  hostOf,
  hostsMatch,
  isMessageOfType,
  isSameOrigin,
  isTrustedMessage,
  parseEmbedAdjust,
  parseEmbedRequest,
  samePageCheck,
} from "../src/lib/embed";

describe("host matching", () => {
  it("ignores www. and case", () => {
    expect(hostOf("https://WWW.Example.com/soup")).toBe("example.com");
    expect(hostsMatch("www.example.com", "example.com")).toBe(true);
    expect(hostsMatch("Example.com", "www.EXAMPLE.com")).toBe(true);
  });

  it("matches a subdomain of the same site but not siblings or look-alikes", () => {
    expect(hostsMatch("recipes.example.com", "example.com")).toBe(true);
    expect(hostsMatch("alice.github.io", "bob.github.io")).toBe(false);
    expect(hostsMatch("notexample.com", "example.com")).toBe(false);
    expect(hostsMatch("example.com.evil.test", "example.com")).toBe(false);
  });

  it("returns null for non-web URLs", () => {
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("embedding origin", () => {
  it("prefers ancestorOrigins[0]", () => {
    expect(
      embeddingOrigin({ ancestorOrigins: ["https://blog.example.com"], referrer: "https://other.test/x" }),
    ).toBe("https://blog.example.com");
  });

  it("falls back to the referrer's origin", () => {
    expect(embeddingOrigin({ ancestorOrigins: [], referrer: "https://blog.example.com/soup?a=1" })).toBe(
      "https://blog.example.com",
    );
  });

  it("is null when neither is available", () => {
    expect(embeddingOrigin({ ancestorOrigins: null, referrer: "" })).toBeNull();
    expect(embeddingOrigin({ ancestorOrigins: ["null"], referrer: "garbage" })).toBeNull();
  });
});

describe("same-page rule", () => {
  it("allows a recipe on the embedding site, ignoring www.", () => {
    expect(samePageCheck("https://www.example.com/soup", "https://example.com")).toEqual({
      ok: true,
      checked: true,
    });
  });

  it("refuses a recipe on another site and names both hosts", () => {
    expect(samePageCheck("https://other.test/soup", "https://www.example.com")).toEqual({
      ok: false,
      reason: "mismatch",
      recipeHost: "other.test",
      pageHost: "example.com",
    });
  });

  it("proceeds when the embedding page is unknown", () => {
    expect(samePageCheck("https://other.test/soup", null)).toEqual({ ok: true, checked: false });
  });

  it("flags an invalid recipe URL", () => {
    expect(samePageCheck("ftp://x.test/a", "https://x.test")).toEqual({ ok: false, reason: "invalid-url" });
  });
});

describe("message checks", () => {
  const parent = {};

  it("checks origin and source", () => {
    expect(isTrustedMessage({ origin: "https://a.test", source: parent }, { origin: "https://a.test", source: parent })).toBe(true);
    expect(isTrustedMessage({ origin: "https://b.test", source: parent }, { origin: "https://a.test", source: parent })).toBe(false);
    expect(isTrustedMessage({ origin: "https://a.test", source: {} }, { origin: "https://a.test", source: parent })).toBe(false);
  });

  it("accepts any origin from the right window only when the parent origin is unknown", () => {
    expect(isTrustedMessage({ origin: "https://b.test", source: parent }, { origin: null, source: parent })).toBe(true);
    expect(isTrustedMessage({ origin: "https://b.test", source: {} }, { origin: null, source: parent })).toBe(false);
  });

  it("checks the message type", () => {
    expect(isMessageOfType({ type: "textsous:artifact" }, "textsous:artifact")).toBe(true);
    expect(isMessageOfType("textsous:artifact", "textsous:artifact")).toBe(false);
    expect(isMessageOfType(null, "textsous:artifact")).toBe(false);
  });
});

describe("embed URLs and params", () => {
  it("builds the same /embed URL as embed.js", () => {
    const url = new URL(buildEmbedUrl("https://open.textsous.com", { url: "https://x.test/r", host: "x.test" }));
    expect(url.pathname).toBe("/embed");
    expect(url.searchParams.get("url")).toBe("https://x.test/r");
    expect(url.searchParams.get("utm_source")).toBe("x.test");
    expect(url.searchParams.get("utm_medium")).toBe("embed");
  });

  it("parses ?src= ahead of ?url=", () => {
    expect(parseEmbedRequest({ url: "https://x.test/r", src: "https://x.test/a.json" })).toEqual({
      kind: "src",
      src: "https://x.test/a.json",
    });
    expect(parseEmbedRequest({ url: [" https://x.test/r "] })).toEqual({ kind: "url", url: "https://x.test/r" });
    expect(parseEmbedRequest({})).toEqual({ kind: "none" });
  });

  it("detects same-origin artifact links", () => {
    expect(isSameOrigin("/api/artifact/x", "https://open.textsous.com/embed")).toBe(true);
    expect(isSameOrigin("https://blog.test/a.json", "https://open.textsous.com/embed")).toBe(false);
  });
});

describe("embed adjustments (?servings=, ?dietary=, ?cuisine=)", () => {
  const url = "https://x.test/r";

  it("attaches a valid adjustment to a url or src request", () => {
    expect(parseEmbedRequest({ url, servings: "18" })).toEqual({ kind: "url", url, adjust: { servings: 18 } });
    expect(parseEmbedRequest({ src: "https://x.test/a.json", dietary: "vegan" })).toEqual({
      kind: "src",
      src: "https://x.test/a.json",
      adjust: { dietary: "vegan" },
    });
    expect(parseEmbedRequest({ url, cuisine: "  Italian  " })).toEqual({ kind: "url", url, adjust: { cuisine: "Italian" } });
    expect(parseEmbedRequest({ servings: "18" })).toEqual({ kind: "none" });
  });

  it("keeps servings inside the adjust range (0.5-36)", () => {
    expect(parseEmbedAdjust({ servings: "0.5" })).toEqual({ servings: 0.5 });
    expect(parseEmbedAdjust({ servings: "36" })).toEqual({ servings: 36 });
    expect(parseEmbedAdjust({ servings: [" 4 ", "9"] })).toEqual({ servings: 4 });
    for (const bad of ["0", "37", "0.25", "-3", "1e1", "0x10", "18abc", "", "Infinity"]) {
      expect(parseEmbedAdjust({ servings: bad })).toBeNull();
    }
  });

  it("takes only the seven diets, in any case", () => {
    expect(parseEmbedAdjust({ dietary: "Gluten-Free" })).toEqual({ dietary: "gluten-free" });
    for (const bad of ["keto", "vegan,dairy-free", "", "paleo"]) expect(parseEmbedAdjust({ dietary: bad })).toBeNull();
  });

  it("takes a style of 1-80 characters once trimmed, tidying control characters and spaces", () => {
    expect(parseEmbedAdjust({ cuisine: "Thai\n\tstreet   food" })).toEqual({ cuisine: "Thai street food" });
    expect(parseEmbedAdjust({ cuisine: "x".repeat(80) })).toEqual({ cuisine: "x".repeat(80) });
    expect(parseEmbedAdjust({ cuisine: "x".repeat(81) })).toBeNull();
    expect(parseEmbedAdjust({ cuisine: "   " })).toBeNull();
  });

  it("ignores invalid values without dropping valid ones", () => {
    expect(parseEmbedAdjust({ servings: "99", dietary: "vegan", cuisine: "" })).toEqual({ dietary: "vegan" });
    expect(parseEmbedRequest({ url, servings: "nope", dietary: "keto" })).toEqual({ kind: "url", url });
  });

  it("says what is happening in one calm line", () => {
    expect(adjustLine({ servings: 18 })).toBe("Scaling to 18 servings\u2026");
    expect(adjustLine({ servings: 1 })).toBe("Scaling to 1 serving\u2026");
    expect(adjustLine({ dietary: "vegan" })).toBe("Making it vegan\u2026");
    expect(adjustLine({ cuisine: "Italian" })).toBe("Making it more Italian\u2026");
    expect(adjustLine({ servings: 18, dietary: "vegan" })).toBe("Scaling to 18 servings and making it vegan\u2026");
    expect(adjustLine({ servings: 2, dietary: "vegan", cuisine: "Thai" })).toBe(
      "Scaling to 2 servings, making it vegan and making it more Thai\u2026",
    );
    expect(adjustLine({})).toBe("");
  });

  it("adds the adjustment to the /embed URL between the recipe and the utm tags", () => {
    const built = buildEmbedUrl("https://open.textsous.com", { url, host: "x.test", adjust: { servings: 18 } });
    expect(built).toBe("https://open.textsous.com/embed?url=https%3A%2F%2Fx.test%2Fr&servings=18&utm_source=x.test&utm_medium=embed");
    const parsed = new URL(buildEmbedUrl("https://open.textsous.com", { url, adjust: { cuisine: "Thai street food" } }));
    expect(parseEmbedRequest(Object.fromEntries(parsed.searchParams))).toEqual({
      kind: "url",
      url,
      adjust: { cuisine: "Thai street food" },
    });
  });
});
