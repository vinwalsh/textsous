import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUrlList, postJson, warmOne, warmTargets } from "../scripts/warm-demo";
import { demoSiteMetadata } from "../src/app/demo-sites/[slug]/BlogPost";
import { DEMO_SITES } from "../src/app/demo-sites/recipes";

describe("warm-demo URL list", () => {
  it("reads the same 20 https URLs the /demo page lists", () => {
    const urls = parseUrlList(readFileSync("eval/urls.txt", "utf8"));
    expect(urls).toHaveLength(20);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
    expect(parseUrlList("# note\n\n https://a.example/x \n")).toEqual(["https://a.example/x"]);
  });

  it("also warms the /embed-demo post and the /demo-sites blogs on the deployed origin (readiness-4)", () => {
    const urls = ["https://a.example/x"];
    expect(warmTargets(urls, "https://open.textsous.com")).toEqual([
      "https://a.example/x",
      "https://open.textsous.com/embed-demo",
      "https://open.textsous.com/demo-sites/lemon-blueberry-muffins",
      "https://open.textsous.com/demo-sites/sheet-pan-chicken",
      "https://open.textsous.com/demo-sites/skillet-cornbread",
      "https://open.textsous.com/demo-sites/turkey-chili",
    ]);
    // http (a local run): the converter refuses http, so the site's own pages are skipped.
    expect(warmTargets(urls, "http://localhost:3101")).toEqual(urls);
  });

  it("warms each blog at the address its canonical link names", () => {
    const base = "https://open.textsous.com";
    const blogs = warmTargets([], base).filter((url) => url.includes("/demo-sites/"));
    expect(blogs).toEqual(DEMO_SITES.map((recipe) => demoSiteMetadata(recipe, base).alternates?.canonical));
  });
});

describe("warm-demo waits for slow conversions (readiness-5)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  /** A local /api/convert that answers after delayMs, like a slow conversion. */
  async function slowConvert(delayMs: number): Promise<string> {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ cached: false, echo: JSON.parse(body) }));
        }, delayMs);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("uses its own socket timeout, not fetch's 300 s header limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not be used"));
    const base = await slowConvert(300);
    const res = await postJson(new URL("/api/convert", base), { url: "https://a.example/x" }, 5_000);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ cached: false, echo: { url: "https://a.example/x" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    const warmed = await warmOne(base, "https://a.example/x", 5_000);
    expect(warmed).toMatchObject({ status: 200, cached: false, reason: null });
  });

  it("reports a timeout only after its own limit", async () => {
    const base = await slowConvert(2_000);
    const warmed = await warmOne(base, "https://a.example/x", 200);
    expect(warmed).toMatchObject({ status: null, reason: "timeout or network error", detail: "no answer after 0 s" });
    expect(warmed.ms).toBeGreaterThanOrEqual(190);
    expect(warmed.ms).toBeLessThan(1_500);
  });

  it("opens a fresh connection for every request, never a kept-alive one", async () => {
    const ports: number[] = [];
    const connections: (string | undefined)[] = [];
    server = createServer((req, res) => {
      ports.push(req.socket.remotePort ?? 0);
      connections.push(req.headers.connection);
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ cached: true }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    for (const url of ["https://a.example/x", "https://a.example/y"]) {
      expect(await warmOne(base, url, 5_000)).toMatchObject({ status: 200, cached: true });
    }
    expect(connections).toEqual(["close", "close"]);
    expect(new Set(ports).size).toBe(2);
  });
});
