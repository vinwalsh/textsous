import { describe, expect, it } from "vitest";
// Next's own source-to-regex builder, so the test matches what the server does.
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import nextConfig from "../next.config";

type Header = { key: string; value: string };

async function headersFor(path: string): Promise<Record<string, string[]>> {
  const rules = (await nextConfig.headers!()) as Array<{ source: string; headers: Header[] }>;
  const out: Record<string, string[]> = {};
  for (const rule of rules) {
    const built = buildCustomRoute("header", rule) as { regex: string };
    if (!new RegExp(built.regex).test(path)) continue;
    for (const h of rule.headers) (out[h.key.toLowerCase()] ??= []).push(h.value);
  }
  return out;
}

describe("next.config headers()", () => {
  it("lets any site frame /embed, and nothing else applies there", async () => {
    const h = await headersFor("/embed");
    expect(h["content-security-policy"]).toEqual(["frame-ancestors *"]);
    expect(h["x-frame-options"]).toBeUndefined();
  });

  it("keeps every other page same-origin only", async () => {
    for (const path of ["/", "/demo", "/embed-demo", "/assistants", "/api/artifact/abc", "/embed/x"]) {
      const h = await headersFor(path);
      expect(h["content-security-policy"], path).toEqual(["frame-ancestors 'self'"]);
      expect(h["x-frame-options"], path).toEqual(["SAMEORIGIN"]);
    }
  });

  it("keeps next dev from rewriting AGENTS.md", () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  it("caches /embed.js a minute in the browser, an hour at the CDN, and allows any origin", async () => {
    const h = await headersFor("/embed.js");
    expect(h["cache-control"]).toEqual(["public, max-age=60, s-maxage=3600"]);
    expect(h["access-control-allow-origin"]).toEqual(["*"]);
  });
});
