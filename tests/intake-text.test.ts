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
});
