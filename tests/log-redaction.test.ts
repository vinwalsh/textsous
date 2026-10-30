import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCachedConversion, stageVersions } from "../src/lib/cache";
import { redact } from "../src/lib/log";
import { POST } from "../src/app/api/convert/route";

describe("redact", () => {
  it("replaces URLs in strings", () => {
    expect(redact("see https://example.com/soup?a=b for more")).toBe("see [url] for more");
    expect(redact("http://insecure.test/x")).toBe("[url]");
  });

  it("replaces data URLs", () => {
    expect(redact("data:image/png;base64,iVBORw0KGgoAAA")).toBe("[data]");
  });

  it("redacts nested objects and arrays", () => {
    expect(redact({ a: ["x https://e.com/y"], b: 3, c: null })).toEqual({
      a: ["x [url]"],
      b: 3,
      c: null,
    });
  });

  it("leaves non-strings and plain text alone", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact("just words")).toBe("just words");
  });
});

describe("convert logs", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("never logs the recipe URL on the cached path", async () => {
    const marker = "redact-probe-9f2c";
    const url = `https://example.com/${marker}`;
    await setCachedConversion(url, {
      artifact: { id: "art-probe" } as never,
      schedule: { tasks: [], criticalPath: [], totalTokens: 0 } as never,
      cachedAt: new Date().toISOString(),
      versions: stageVersions(),
      checksPassed: true,
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await POST(
        new Request("http://localhost/api/convert", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.1" },
          body: JSON.stringify({ url }),
        }),
      );
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          if (typeof arg === "string") {
            expect(arg).not.toContain(marker);
            expect(arg).not.toContain("https://");
          }
        }
      }
    } finally {
      spy.mockRestore();
    }
  });
});
