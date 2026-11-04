import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildEmbedUrl } from "../src/lib/embed";
import { DIETARY_TARGETS } from "../src/lib/schema/variant";

const code = readFileSync("public/embed.js", "utf8");

type Adjust = { servings?: number; dietary?: string; cuisine?: string };

interface EmbedApi {
  version: number;
  resolveRecipeUrl: (input: { attr?: string | null; canonical?: string | null; href: string }) => string | null;
  resolveSrc: (value: string | null, href: string) => string | null;
  scriptOrigin: (src: string) => string;
  buildFrameUrl: (
    origin: string,
    opts: { url?: string | null; src?: string | null; host?: string; adjust?: Adjust },
  ) => string;
  isTrustedMessage: (
    event: { origin: string; source?: unknown; data: unknown },
    origin: string | string[],
    source: unknown,
    type: string,
  ) => boolean;
  isOn: (value: string | null) => boolean;
  trustedOrigins: (origin: string) => string[];
  pickTarget: (input: {
    own?: { src?: string | null; recipeUrl?: string | null };
    script?: { src?: string | null; recipeUrl?: string | null };
    canonical?: string | null;
    href: string;
  }) => { url?: string | null; src?: string };
  backgroundElements: (children: ArrayLike<unknown>, overlayHost: unknown) => unknown[];
  diets: string[];
  modeOf: (value: string | null) => "adjust" | "cook-along";
  yieldServings: (value: unknown) => number | null;
  findRecipeYield: (texts: string[]) => unknown;
  defaultServings: (texts: string[]) => number;
  parseServings: (value: unknown) => number | null;
  cleanCuisine: (value: unknown) => string | null;
  adjustForChoice: (kind: string, value: unknown) => Adjust | null;
  dietLabel: (diet: string) => string;
  menuShift: (buttonLeft: number, menuWidth: number, viewportWidth: number, gutter: number) => number;
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

describe("embed.js placement targets", () => {
  const api = load();
  const href = "https://blog.example.com/page#top";
  const canonical = "https://blog.example.com/canonical";

  it("lets a placement's own data-recipe-url beat a data-src on the script tag", () => {
    expect(
      api.pickTarget({
        own: { recipeUrl: "/recipes/salad" },
        script: { src: "/a.cookalong.json" },
        canonical,
        href,
      }),
    ).toEqual({ url: "https://blog.example.com/recipes/salad" });
  });

  it("uses a placement's own data-src first", () => {
    expect(
      api.pickTarget({ own: { src: "/b.json", recipeUrl: "/recipes/salad" }, script: { src: "/a.json" }, href }),
    ).toEqual({ src: "https://blog.example.com/b.json" });
  });

  it("falls back to the script tag's data-src, then its data-recipe-url, then canonical", () => {
    expect(api.pickTarget({ own: {}, script: { src: "/a.json", recipeUrl: "/r" }, canonical, href })).toEqual({
      src: "https://blog.example.com/a.json",
    });
    expect(api.pickTarget({ own: {}, script: { recipeUrl: "/r#x" }, canonical, href })).toEqual({
      url: "https://blog.example.com/r",
    });
    expect(api.pickTarget({ canonical, href })).toEqual({ url: canonical });
    expect(api.pickTarget({ href })).toEqual({ url: "https://blog.example.com/page" });
  });

  it("ignores an unusable own data-recipe-url instead of letting it hide the script's data-src", () => {
    expect(api.pickTarget({ own: { recipeUrl: "javascript:void 0" }, script: { src: "/a.json" }, href })).toEqual({
      src: "https://blog.example.com/a.json",
    });
  });
});

describe("embed.js http script origin", () => {
  const api = load();
  const frame = {};

  it("trusts the https twin of an http script origin (the host redirects /embed to https)", () => {
    expect(api.trustedOrigins("http://open.textsous.com")).toEqual([
      "http://open.textsous.com",
      "https://open.textsous.com",
    ]);
    expect(api.trustedOrigins("https://open.textsous.com")).toEqual(["https://open.textsous.com"]);
    const origins = api.trustedOrigins("http://open.textsous.com");
    const msg = (origin: string) => ({ origin, source: frame, data: { type: "textsous:close" } });
    expect(api.isTrustedMessage(msg("https://open.textsous.com"), origins, frame, "textsous:close")).toBe(true);
    expect(api.isTrustedMessage(msg("http://open.textsous.com"), origins, frame, "textsous:close")).toBe(true);
    expect(api.isTrustedMessage(msg("https://evil.test"), origins, frame, "textsous:close")).toBe(false);
  });

  it("still works for a local http copy", () => {
    const origins = api.trustedOrigins("http://localhost:3102");
    expect(origins[0]).toBe("http://localhost:3102");
  });
});

describe("embed.js modal background", () => {
  const api = load();
  function el(tag: string, attrs: string[] = []) {
    return { nodeType: 1, tagName: tag, hasAttribute: (name: string) => attrs.includes(name) };
  }

  it("makes every visible body child inert except the overlay and ones already inert", () => {
    const overlay = el("DIV");
    const header = el("HEADER");
    const main = el("MAIN");
    const already = el("ASIDE", ["inert"]);
    const script = el("SCRIPT");
    const style = el("STYLE");
    const text = { nodeType: 3 };
    expect(api.backgroundElements([header, main, already, script, style, text, overlay], overlay)).toEqual([
      header,
      main,
    ]);
  });
});

describe("embed.js overlay wiring (source checks)", () => {
  it("traps focus with sentinels and makes the page behind inert", () => {
    expect(code).toMatch(/makeBackgroundInert\(host\)/);
    expect(code).toMatch(/restoreBackground\(current\.inerted\)/);
    // Restore the background before returning focus to the button that lives in it.
    expect(code.indexOf("restoreBackground(current.inerted)")).toBeLessThan(code.indexOf("current.returnFocus.focus()"));
    expect(code).toMatch(/dialog\.appendChild\(endSentinel\)/);
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

  it("hands the second copy's script tag to the first, so a bookmarklet's data-floating counts", () => {
    const tag = { nodeType: 1 };
    let got: unknown = "nothing";
    const win: Record<string, unknown> = {
      TextSousEmbed: { version: 1, scan: (extra: unknown) => (got = extra) },
      document: { currentScript: tag },
    };
    runInNewContext(code, { window: win, URL, URLSearchParams });
    expect(got).toBe(tag);
  });
});

describe("embed.js Adjust with SOUS: choices", () => {
  const api = load();

  it("keeps the same diet list as the adjust route", () => {
    expect(api.diets).toEqual([...DIETARY_TARGETS]);
    expect(api.diets.map(api.dietLabel)).toEqual([
      "Dairy-free",
      "Egg-free",
      "Gluten-free",
      "Nut-free",
      "Soy-free",
      "Vegetarian",
      "Vegan",
    ]);
  });

  it("reads the script tag's data-mode", () => {
    expect(api.modeOf("adjust")).toBe("adjust");
    expect(api.modeOf(" Adjust ")).toBe("adjust");
    expect(api.modeOf(null)).toBe("cook-along");
    expect(api.modeOf("")).toBe("cook-along");
    expect(api.modeOf("cook-along")).toBe("cook-along");
  });

  it("accepts whole servings from 1 to 36 only", () => {
    expect(api.parseServings("18")).toBe(18);
    expect(api.parseServings(" 7 ")).toBe(7);
    expect(api.parseServings(36)).toBe(36);
    expect(api.parseServings("1")).toBe(1);
    for (const bad of ["0", "37", "1.5", "-2", "abc", "", "1e1", null, undefined]) {
      expect(api.parseServings(bad)).toBeNull();
    }
  });

  it("tidies a style and keeps it to 80 characters", () => {
    expect(api.cleanCuisine("  Italian  ")).toBe("Italian");
    expect(api.cleanCuisine("Thai\nstreet   food")).toBe("Thai street food");
    expect(api.cleanCuisine("a".repeat(80))).toBe("a".repeat(80));
    expect(api.cleanCuisine("a".repeat(81))).toBeNull();
    expect(api.cleanCuisine("   ")).toBeNull();
    expect(api.cleanCuisine(null)).toBeNull();
  });

  it("turns each menu choice into the overlay's adjustment, or null when it won't work", () => {
    expect(api.adjustForChoice("servings", "18")).toEqual({ servings: 18 });
    expect(api.adjustForChoice("servings", "40")).toBeNull();
    expect(api.adjustForChoice("dietary", "vegan")).toEqual({ dietary: "vegan" });
    expect(api.adjustForChoice("dietary", "keto")).toBeNull();
    expect(api.adjustForChoice("cuisine", " Italian ")).toEqual({ cuisine: "Italian" });
    expect(api.adjustForChoice("cuisine", "")).toBeNull();
    expect(api.adjustForChoice("cook-along", null)).toEqual({});
    expect(api.adjustForChoice("other", "x")).toBeNull();
  });
});

describe("embed.js Adjust with SOUS: servings from the page's recipe", () => {
  const api = load();
  const ld = (node: unknown) => JSON.stringify(node);

  it("reads the first whole number of recipeYield", () => {
    expect(api.yieldServings("12 muffins")).toBe(12);
    expect(api.yieldServings(4)).toBe(4);
    expect(api.yieldServings(["4", "4 servings"])).toBe(4);
    expect(api.yieldServings("Serves 4-6")).toBe(4);
    expect(api.yieldServings(["", "makes 8"])).toBe(8);
    expect(api.yieldServings("0")).toBeNull();
    expect(api.yieldServings("a few")).toBeNull();
    expect(api.yieldServings(null)).toBeNull();
  });

  it("finds the Recipe at the top level, in a list, in @graph or as mainEntity", () => {
    expect(api.findRecipeYield([ld({ "@type": "Recipe", recipeYield: "6" })])).toBe("6");
    expect(api.findRecipeYield([ld([{ "@type": "WebPage" }, { "@type": ["Recipe"], recipeYield: 2 }])])).toBe(2);
    expect(
      api.findRecipeYield([ld({ "@graph": [{ "@type": "Person" }, { "@type": "Recipe", recipeYield: ["3"] }] })]),
    ).toEqual(["3"]);
    expect(api.findRecipeYield([ld({ "@type": "WebPage", mainEntity: { "@type": "Recipe", recipeYield: "5" } })])).toBe(
      "5",
    );
    expect(api.findRecipeYield(["{not json", ld({ "@type": "Recipe", recipeYield: "9" })])).toBe("9");
    expect(api.findRecipeYield([ld({ "@type": "Article" })])).toBeNull();
    expect(api.findRecipeYield([])).toBeNull();
  });

  it("starts the stepper at the yield, kept within 1-36, else at 4", () => {
    expect(api.defaultServings([ld({ "@type": "Recipe", recipeYield: "12 muffins" })])).toBe(12);
    expect(api.defaultServings([ld({ "@type": "Recipe", recipeYield: "48 cookies" })])).toBe(36);
    expect(api.defaultServings([ld({ "@type": "Recipe" })])).toBe(4);
    expect(api.defaultServings([])).toBe(4);
  });
});

describe("embed.js Adjust with SOUS: overlay address and menu placement", () => {
  const api = load();
  const origin = "https://open.textsous.com";
  const recipe = "https://blog.example.com/soup";

  it("leaves the Cook Along address exactly as before", () => {
    expect(api.buildFrameUrl(origin, { url: recipe, host: "blog.example.com" })).toBe(
      "https://open.textsous.com/embed?url=https%3A%2F%2Fblog.example.com%2Fsoup&utm_source=blog.example.com&utm_medium=embed",
    );
    expect(api.buildFrameUrl(origin, { url: recipe, host: "blog.example.com", adjust: {} })).toBe(
      api.buildFrameUrl(origin, { url: recipe, host: "blog.example.com" }),
    );
  });

  it("adds servings, dietary or cuisine for a menu choice", () => {
    const frame = (adjust: Adjust) => new URL(api.buildFrameUrl(origin, { url: recipe, host: "blog.example.com", adjust }));
    expect(frame({ servings: 18 }).searchParams.get("servings")).toBe("18");
    expect(frame({ dietary: "vegan" }).searchParams.get("dietary")).toBe("vegan");
    const styled = frame({ cuisine: "Thai street food" });
    expect(styled.searchParams.get("cuisine")).toBe("Thai street food");
    expect(styled.searchParams.get("url")).toBe(recipe);
    expect(styled.searchParams.get("utm_medium")).toBe("embed");
    const src = new URL(api.buildFrameUrl(origin, { src: "https://blog.example.com/a.json", adjust: { servings: 2 } }));
    expect(src.searchParams.get("src")).toBe("https://blog.example.com/a.json");
    expect(src.searchParams.get("servings")).toBe("2");
  });

  it("matches buildEmbedUrl in src/lib/embed.ts", () => {
    for (const adjust of [undefined, { servings: 18 }, { dietary: "vegan" as const }, { cuisine: "Italian" }]) {
      expect(api.buildFrameUrl(origin, { url: recipe, host: "blog.example.com", adjust })).toBe(
        buildEmbedUrl(origin, { url: recipe, host: "blog.example.com", adjust }),
      );
    }
  });

  it("moves the menu left near the right edge so a 320 px phone never scrolls sideways", () => {
    expect(api.menuShift(16, 340, 1280, 16)).toBe(0);
    expect(api.menuShift(1000, 340, 1280, 16)).toBe(-76);
    expect(api.menuShift(200, 288, 320, 16)).toBe(-184);
    expect(api.menuShift(4, 288, 320, 16)).toBe(12);
  });
});

describe("embed.js Adjust with SOUS: wiring (source checks)", () => {
  it("finds data-textsous-adjust placements and the script tag's data-mode and data-floating", () => {
    expect(code).toContain('d.querySelectorAll("[data-textsous-adjust]")');
    expect(code).toContain('modeOf(script.getAttribute("data-mode")) === "adjust"');
    expect(code).toContain('isOn(tag.getAttribute("data-floating"))');
  });

  it("never navigates the host page: no form, every button is type=button", () => {
    expect(code).not.toMatch(/createElement\(["']form["']\)|h\(["']form["']|innerHTML = ["'][^"']*<form/);
    const buttons = code.match(/h\("button", \{[^}]*\}/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    for (const button of buttons) expect(button).toContain('type: "button"');
    expect(code).toContain('event.key !== "Enter"');
  });

  it("closes the menu on Esc (focus back to the button) and on a click outside", () => {
    expect(code).toMatch(/event\.key === "Escape" \|\| event\.key === "Esc"\) closeMenu\(true\)/);
    expect(code).toContain('d.addEventListener("click", onOutside, true)');
    expect(code).toContain('d.removeEventListener("click", onOutside, true)');
  });

  it("opens the existing overlay with the choice, returning focus to the button", () => {
    expect(code).toContain("open(targetFor(el), trigger, adjust)");
    expect(code).toMatch(/closeMenu\(true\);[^\n]*\n\s*open\(targetFor\(el\), trigger, adjust\)/);
  });
});
