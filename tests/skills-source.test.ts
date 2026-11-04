import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { POST as sourcePOST } from "../src/app/api/skills/source/route";
import { POST as cookAlongPOST } from "../src/app/api/skills/cook-along/route";
import { COOK_ALONG_EXAMPLE } from "../src/lib/skills";
import { classifyIntakeError } from "../src/lib/skills/source";
import { resetSkillsRateLimits } from "../src/lib/skills/http";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

type LookupAll = (hostname: string, opts: { all: true }) => Promise<Array<{ address: string; family: number }>>;
const mockedLookup = lookup as unknown as MockedFunction<LookupAll>;

const SECRET = "test-skills-secret";
// A public IP literal skips DNS, and fetch is stubbed: no network.
const PUBLIC = "https://93.184.216.34";
const fixtureHtml = readFileSync("eval/fixtures/toasted-oat-porridge.html", "utf8");

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.SKILLS_API_SECRET = SECRET;
  process.env.ARTIFACT_SIGNING_SECRET = "test-signing-secret";
  process.env.ARTIFACT_STORE_DIR = mkdtempSync(path.join(tmpdir(), "skills-src-"));
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetSkillsRateLimits();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockedLookup.mockReset();
  delete process.env.SKILLS_API_SECRET;
});

describe("POST /api/skills/source", () => {
  it("returns credit, schema.org fields and readable text for a recipe page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(fixtureHtml)));
    const res = await sourcePOST(post("/api/skills/source", { url: `${PUBLIC}/porridge?utm_source=x` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: { url: string; site: string; author: string; title: string; jsonLd: Record<string, unknown>; text: string };
    };
    expect(body.ok).toBe(true);
    expect(body.source.url).toBe("https://example.com/recipes/toasted-oat-porridge");
    expect(body.source.site).toBe("TextSous Fixtures");
    expect(body.source.author).toBe("TextSous Kitchen");
    expect(body.source.title).toBe("Toasted Oat Porridge with Brown Butter Apples");
    expect(body.source.jsonLd.recipeIngredient).toContain("1 medium apple, diced");
    expect(body.source.jsonLd.recipeInstructions).toContain("[Apples] Melt the butter in a small skillet until it foams and smells nutty.");
    expect(body.source.jsonLd.recipeYield).toBe("2 servings");
    expect(body.source.text).toContain("- 2 cups whole milk");
    expect(body.source.text).toContain("simmer 6 minutes");
    expect(body.source.text.length).toBeLessThanOrEqual(60_000);
  });

  it("refuses non-https and private addresses without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["http://example.com/r", "https://127.0.0.1/r", "https://localhost/r", "not a url"]) {
      const res = await sourcePOST(post("/api/skills/source", { url }));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, error: { code: "refused_url" } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports multiple recipes, fetch failures and non-recipe pages", async () => {
    const two = `<html><head>
      <script type="application/ld+json">{"@type":"Recipe","name":"A"}</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"B"}</script></head><body></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => html(two)));
    let res = await sourcePOST(post("/api/skills/source", { url: `${PUBLIC}/two` }));
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "multiple_recipes" } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    res = await sourcePOST(post("/api/skills/source", { url: `${PUBLIC}/blocked` }));
    expect(res.status).toBe(422);
    const failed = (await res.json()) as { error: { code: string; message: string } };
    expect(failed.error.code).toBe("fetch_failed");
    expect(failed.error.message).toMatch(/paste the recipe text/);

    vi.stubGlobal("fetch", vi.fn(async () => html("<html><body><article>Our team and our story.</article></body></html>")));
    res = await sourcePOST(post("/api/skills/source", { url: `${PUBLIC}/about` }));
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "not_a_recipe" } });
  });

  it("classifies intake errors", () => {
    expect(classifyIntakeError("Refusing page with 2 recipes; single-recipe pages only.")).toBe("multiple_recipes");
    expect(classifyIntakeError("Refusing to fetch a private-network address.")).toBe("refused_url");
    expect(classifyIntakeError("Fetch timed out after 10000ms.")).toBe("fetch_failed");
  });
});

describe("POST /api/skills/cook-along with a url source", () => {
  const urlBody = () => {
    const body = JSON.parse(JSON.stringify(COOK_ALONG_EXAMPLE)) as typeof COOK_ALONG_EXAMPLE;
    body.source = { kind: "url", url: `${PUBLIC}/porridge`, site: "Wrong Site", author: "Wrong Author" };
    return body;
  };

  it("re-fetches the page for authoritative credit and quote checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(fixtureHtml)));
    const res = await cookAlongPOST(post("/api/skills/cook-along", urlBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifactUrl: string; warnings: unknown[] };
    expect(body.warnings).toEqual([]);
    const { loadArtifact } = await import("../src/lib/artifact-store");
    const id = new URL(body.artifactUrl).pathname.split("/").pop() as string;
    const stored = await loadArtifact(id);
    expect(stored?.artifact.recipe.credit).toMatchObject({
      kind: "url",
      url: "https://example.com/recipes/toasted-oat-porridge",
      site: "TextSous Fixtures",
      author: "TextSous Kitchen",
    });
  });

  it("falls back to the body's text with a warning when the page cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const body = urlBody();
    body.source.text = COOK_ALONG_EXAMPLE.source.text;
    const res = await cookAlongPOST(post("/api/skills/cook-along", body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: Array<{ code: string }> };
    expect(json.warnings.map((w) => w.code)).toContain("source_fetch_failed");
  });

  it("refuses a private source url", async () => {
    const body = urlBody();
    body.source.url = "https://10.0.0.1/recipe";
    const res = await cookAlongPOST(post("/api/skills/cook-along", body));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: "source.url", code: "refused_url" }] });
  });
});
