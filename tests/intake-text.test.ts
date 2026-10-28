import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFromText, MAX_TEXT_CHARS } from "../src/lib/intake/text";

describe("extractFromText", () => {
  it("trims pasted text", () => {
    expect(extractFromText("  \nChili\nServes 2\n  ").rawText).toBe("Chili\nServes 2");
  });

  it("rejects empty text", () => {
    expect(() => extractFromText("   \n  ")).toThrow(/No text provided/);
  });

  it("rejects over-long text", () => {
    expect(() => extractFromText("x".repeat(MAX_TEXT_CHARS + 1))).toThrow(/too long/);
  });

  it("reads the pasted-text fixture", () => {
    const raw = readFileSync("eval/fixtures/herby-white-bean-toast.txt", "utf8");
    const result = extractFromText(raw);
    expect(result.kind).toBe("text");
    expect(result.rawText).toContain("Herby White Bean Toast");
    expect(result.rawText).toContain("Mash half the beans");
    expect(result.rawText).not.toMatch(/^\s|\s$/);
  });
});
