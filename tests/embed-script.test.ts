import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const code = readFileSync("public/embed.js", "utf8");

interface EmbedApi {
  version: number;
  resolveRecipeUrl: (input: { attr?: string | null; canonical?: string | null; href: string }) => string | null;
  resolveSrc: (value: string | null, href: string) => string | null;
  scriptOrigin: (src: string) => string;
  buildFrameUrl: (origin: string, opts: { url?: string | null; src?: string | null; host?: string }) => string;
  isTrustedMessage: (
    event: { origin: string; source?: unknown; data: unknown },
    origin: string,
    source: unknown,
    type: string,
  ) => boolean;
  isOn: (value: string | null) => boolean;
  scan?: () => void;
}

/** Run embed.js with a window but no document: it only exposes its helpers. */
function load(win: Record<string, unknown> = {}): EmbedApi {
  runInNewContext(code, { window: win, URL, URLSearchParams });
  return win.TextSousEmbed as EmbedApi;
}

describe("embed.js recipe URL resolution", () => {
  const api = load();
  const href = "https://blog.example.com/soup?ref=nav#comments";

  it("prefers data-recipe-url, resolved against the page", () => {
    expect(api.resolveRecipeUrl({ attr: "/recipes/soup", canonical: "https://x.test/c", href })).toBe(
      "https://blog.example.com/recipes/soup",
    );
  });

  it("falls back to the canonical link, then the page without its hash", () => {
    expect(api.resolveRecipeUrl({ attr: null, canonical: "https://blog.example.com/soup", href })).toBe(
      "https://blog.example.com/soup",
    );
    expect(api.resolveRecipeUrl({ attr: "", canonical: null, href })).toBe(
      "https://blog.example.com/soup?ref=nav",
    );
  });

  it("drops a hash from an explicit URL and skips non-web schemes", () => {
    expect(api.resolveRecipeUrl({ attr: "https://a.test/r#top", href })).toBe("https://a.test/r");
    expect(api.resolveRecipeUrl({ attr: "javascript:alert(1)", canonical: null, href })).toBe(
      "https://blog.example.com/soup?ref=nav",
    );
  });

  it("resolves data-src against the page and refuses other schemes", () => {
    expect(api.resolveSrc("/cook/soup.json", href)).toBe("https://blog.example.com/cook/soup.json");
    expect(api.resolveSrc("data:application/json,{}", href)).toBeNull();
    expect(api.resolveSrc("  ", href)).toBeNull();
    expect(api.resolveSrc(null, href)).toBeNull();
  });
});

describe("embed.js script origin and frame URL", () => {
  const api = load();

  it("uses the script's own origin so local and preview copies point at themselves", () => {
    expect(api.scriptOrigin("http://localhost:3102/embed.js")).toBe("http://localhost:3102");
    expect(api.scriptOrigin("https://open.textsous.com/embed.js?v=2")).toBe("https://open.textsous.com");
  });

  it("falls back to open.textsous.com when the script source is unknown", () => {
    expect(api.scriptOrigin("")).toBe("https://open.textsous.com");
    expect(api.scriptOrigin("not a url")).toBe("https://open.textsous.com");
  });

  it("builds /embed?url=...&utm_source=<host>&utm_medium=embed", () => {
    const frame = new URL(
      api.buildFrameUrl("https://open.textsous.com", {
        url: "https://blog.example.com/soup?a=1&b=2",
        host: "blog.example.com",
      }),
    );
    expect(frame.origin + frame.pathname).toBe("https://open.textsous.com/embed");
    expect(frame.searchParams.get("url")).toBe("https://blog.example.com/soup?a=1&b=2");
    expect(frame.searchParams.get("utm_source")).toBe("blog.example.com");
    expect(frame.searchParams.get("utm_medium")).toBe("embed");
    expect(frame.searchParams.has("src")).toBe(false);
  });

  it("uses src instead of url for a pre-converted artifact", () => {
    const frame = new URL(
      api.buildFrameUrl("http://localhost:3102/", { url: "https://x.test/r", src: "https://x.test/r.json" }),
    );
    expect(frame.origin).toBe("http://localhost:3102");
    expect(frame.searchParams.get("src")).toBe("https://x.test/r.json");
    expect(frame.searchParams.has("url")).toBe(false);
  });
});

describe("embed.js message checks", () => {
  const api = load();
  const frame = {};

  it("accepts textsous:close only from the iframe's window and origin", () => {
    const ok = { origin: "https://open.textsous.com", source: frame, data: { type: "textsous:close" } };
    expect(api.isTrustedMessage(ok, "https://open.textsous.com", frame, "textsous:close")).toBe(true);
    expect(
      api.isTrustedMessage({ ...ok, origin: "https://evil.test" }, "https://open.textsous.com", frame, "textsous:close"),
    ).toBe(false);
    expect(api.isTrustedMessage({ ...ok, source: {} }, "https://open.textsous.com", frame, "textsous:close")).toBe(
      false,
    );
    expect(
      api.isTrustedMessage({ ...ok, data: "textsous:close" }, "https://open.textsous.com", frame, "textsous:close"),
    ).toBe(false);
    expect(
      api.isTrustedMessage({ ...ok, data: { type: "other" } }, "https://open.textsous.com", frame, "textsous:close"),
    ).toBe(false);
  });

  it("reads data-autoopen like a boolean attribute", () => {
    expect(api.isOn("")).toBe(true);
    expect(api.isOn("true")).toBe(true);
    expect(api.isOn(null)).toBe(false);
    expect(api.isOn("false")).toBe(false);
    expect(api.isOn("0")).toBe(false);
  });
});

describe("embed.js idempotency", () => {
  it("keeps the first copy when the script is included twice", () => {
    const win: Record<string, unknown> = {};
    const first = load(win);
    runInNewContext(code, { window: win, URL, URLSearchParams });
    expect(win.TextSousEmbed).toBe(first);
  });

  it("asks the first copy to scan for new placements on a second include", () => {
    let scans = 0;
    const win: Record<string, unknown> = {
      TextSousEmbed: { version: 1, scan: () => (scans += 1) },
      document: { currentScript: null },
    };
    runInNewContext(code, { window: win, URL, URLSearchParams });
    expect(scans).toBe(1);
  });
});
