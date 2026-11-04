import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUrlList } from "../scripts/warm-demo";

describe("warm-demo URL list", () => {
  it("reads the same 20 https URLs the /demo page lists", () => {
    const urls = parseUrlList(readFileSync("eval/urls.txt", "utf8"));
    expect(urls).toHaveLength(20);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
    expect(parseUrlList("# note\n\n https://a.example/x \n")).toEqual(["https://a.example/x"]);
  });
});
