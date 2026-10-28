import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { afterEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { FETCH_TIMEOUT_MS, MAX_BYTES, fetchAndExtract } from "../src/lib/intake/url";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

type LookupAll = (hostname: string, opts: { all: true }) => Promise<
  Array<{ address: string; family: number }>
>;
const mockedLookup = lookup as unknown as MockedFunction<LookupAll>;
const fixtureHtml = readFileSync("eval/fixtures/toasted-oat-porridge.html", "utf8");

// Public IP literals skip DNS resolution, and every fetch below is stubbed,
// so these tests never touch the network.
const PUBLIC = "https://93.184.216.34";

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockReset();
});

describe("fetchAndExtract guards", () => {
  it("refuses non-https URLs without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAndExtract("http://example.com/r")).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses private IP literals and private hostnames without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "https://127.0.0.1/r",
      "https://10.0.0.5/r",
      "https://192.168.1.1/r",
      "https://localhost/r",
      "https://host.local/r",
      "https://host.internal/r",
    ]) {
      await expect(fetchAndExtract(url)).rejects.toThrow(/private-network/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("refuses hosts that resolve to private addresses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockedLookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(fetchAndExtract("https://example.com/r")).rejects.toThrow(/private-network/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows up to 3 redirects then extracts the recipe", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(redirectResponse(`${PUBLIC}/b`))
        .mockResolvedValueOnce(redirectResponse(`${PUBLIC}/c`))
        .mockResolvedValueOnce(htmlResponse(fixtureHtml)),
    );
    const result = await fetchAndExtract(`${PUBLIC}/a`);
    expect(result.title).toBe("Toasted Oat Porridge with Brown Butter Apples");
    expect(result.hasJsonLd).toBe(true);
    expect(result.finalUrl).toBe(`${PUBLIC}/c`);
  });

  it("refuses more than 3 redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirectResponse(`${PUBLIC}/loop`)));
    await expect(fetchAndExtract(`${PUBLIC}/a`)).rejects.toThrow(/Too many redirects/);
  });

  it("refuses non-HTML content and HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
        ),
    );
    await expect(fetchAndExtract(`${PUBLIC}/a`)).rejects.toThrow(/Unsupported content type/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(fetchAndExtract(`${PUBLIC}/a`)).rejects.toThrow(/status 404/);
  });

  it("enforces the 2 MB cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x".repeat(MAX_BYTES + 1), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(fetchAndExtract(`${PUBLIC}/a`)).rejects.toThrow(/byte cap/);
  });

  it("times out slow responses", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          (_input: unknown, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        ),
      );
      const pending = fetchAndExtract(`${PUBLIC}/slow`);
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
