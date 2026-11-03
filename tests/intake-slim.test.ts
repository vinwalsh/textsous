import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intake cheerio import", () => {
  it("uses the slim build so the undici package never loads (its import breaks model fetch in some shells)", () => {
    const source = readFileSync("src/lib/intake/url.ts", "utf8");
    expect(source).toContain('from "cheerio/slim"');
    expect(source).not.toMatch(/from "cheerio"/);
  });
});
