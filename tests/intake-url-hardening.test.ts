import { lookup } from "node:dns/promises";
import { afterEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import {
  creditUrlFor,
  extractFromHtml,
  FETCH_TIMEOUT_MS,
  fetchAndExtract,
} from "../src/lib/intake/url";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

type LookupAll = (hostname: string, opts: { all: true }) => Promise<
  Array<{ address: string; family: number }>
>;
const mockedLookup = lookup as unknown as MockedFunction<LookupAll>;
const PUBLIC = "https://93.184.216.34";

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockReset();
  vi.useRealTimers();
});

function html(body: string, head = ""): Response {
  return new Response(`<html><head>${head}</head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("SSRF guards", () => {
  it("refuses a redirect to a private address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAndExtract(`${PUBLIC}/r`)).rejects.toThrow(/private-network/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a host that resolves privately", async () => {
    mockedLookup.mockResolvedValue([{ address: "100.64.1.2", family: 4 }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://internal.example.com/" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAndExtract(`${PUBLIC}/r`)).rejects.toThrow(/private-network/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses bracketed IPv6 literals without DNS or fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "https://[::1]/r",
      "https://[2606:4700::1111]/r",
      "https://[::ffff:127.0.0.1]/r",
      "https://[64:ff9b::a00:1]/r",
    ]) {
      await expect(fetchAndExtract(url)).rejects.toThrow(/private-network/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("refuses CGNAT, benchmarking, NAT64 and mapped private addresses from DNS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const address of [
      { address: "100.64.0.1", family: 4 },
      { address: "100.127.255.254", family: 4 },
      { address: "198.18.0.1", family: 4 },
      { address: "198.19.255.1", family: 4 },
      { address: "64:ff9b::808:808", family: 6 },
      { address: "::ffff:7f00:1", family: 6 },
      { address: "fd00::1", family: 6 },
    ]) {
      mockedLookup.mockResolvedValueOnce([address]);
      await expect(fetchAndExtract("https://example.com/r")).rejects.toThrow(/private-network/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows public addresses next to the blocked ranges", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => html("ok")));
    for (const address of ["100.128.0.1", "198.20.0.1", "2606:4700::1111"]) {
      mockedLookup.mockResolvedValueOnce([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(fetchAndExtract("https://example.com/r")).resolves.toBeTruthy();
    }
  });

  it("refuses non-default ports", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAndExtract("https://93.184.216.34:8443/r")).rejects.toThrow(/default https port/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stalled body", () => {
  it("times out when headers arrive but the body never finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html><body>partial"));
            // never closes
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
      }),
    );
    const pending = fetchAndExtract(`${PUBLIC}/stall`);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1000);
    await assertion;
  });
});

describe("credit URL", () => {
  const fetched = "https://www.example.com/recipes/soup?id=1";

  it("keeps an https canonical on the same host, ignoring www.", () => {
    expect(creditUrlFor("https://example.com/recipes/soup", fetched)).toBe(
      "https://example.com/recipes/soup",
    );
    expect(creditUrlFor("/recipes/soup", fetched)).toBe("https://www.example.com/recipes/soup");
  });

  it("falls back to the fetched URL for non-https, other hosts or odd ports", () => {
    expect(creditUrlFor("http://example.com/recipes/soup", fetched)).toBe(fetched);
    expect(creditUrlFor("https://evil.example.net/soup", fetched)).toBe(fetched);
    expect(creditUrlFor("https://example.com:8443/soup", fetched)).toBe(fetched);
    expect(creditUrlFor("javascript:alert(1)", fetched)).toBe(fetched);
    expect(creditUrlFor(undefined, fetched)).toBe(fetched);
  });

  it("extractFromHtml credits the fetched URL when the canonical is not https", () => {
    const page = `<html><head><link rel="canonical" href="http://example.com/soup"></head><body>Soup</body></html>`;
    expect(extractFromHtml(page, "https://example.com/soup?x=1").canonicalUrl).toBe(
      "https://example.com/soup?x=1",
    );
  });
});
