import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const setCalls: Array<{ key: string; opts: unknown }> = [];

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async get(key: string) {
      return store.get(key) ?? null;
    }
    async set(key: string, value: unknown, opts: unknown) {
      store.set(key, value);
      setCalls.push({ key, opts });
      return "OK";
    }
  },
}));

const {
  CACHE_TTL_SECONDS,
  cacheKeyForUrl,
  getCachedConversion,
  legacyCacheKeyForUrl,
  setCachedConversion,
  stageVersions,
} = await import("../src/lib/cache");

const ENV = ["MODEL_ID", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  delete process.env.MODEL_ID;
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-upstash.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake";
  store.clear();
  setCalls.length = 0;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const VALUE = {
  artifact: { id: "art-cache" } as never,
  schedule: { tasks: [], criticalPath: [], totalMinutes: 0 },
  cachedAt: "2026-11-03T00:00:00.000Z",
  versions: stageVersions(),
  checksPassed: true,
};

describe("conversion cache", () => {
  it("keys by URL, stage versions and model id", () => {
    const url = "https://example.com/r";
    expect(cacheKeyForUrl(url, "muse-spark-1.3")).not.toBe(cacheKeyForUrl(url, "other-model"));
    expect(cacheKeyForUrl(url, "muse-spark-1.3")).not.toBe(legacyCacheKeyForUrl(url));
    process.env.MODEL_ID = "other-model";
    expect(cacheKeyForUrl(url)).toBe(cacheKeyForUrl(url, "other-model"));
  });

  it("stores entries for 30 days", async () => {
    expect(CACHE_TTL_SECONDS).toBe(60 * 60 * 24 * 30);
    await setCachedConversion("https://example.com/r", VALUE);
    expect(setCalls[0].opts).toEqual({ ex: 60 * 60 * 24 * 30 });
  });

  it("reads a pre-model-id entry once for the default model and copies it forward", async () => {
    const url = "https://example.com/legacy";
    store.set(legacyCacheKeyForUrl(url), VALUE);
    const hit = await getCachedConversion(url);
    expect(hit).toEqual(VALUE);
    expect(store.get(cacheKeyForUrl(url, "muse-spark-1.3"))).toEqual(VALUE);
    expect(setCalls[0].opts).toEqual({ ex: CACHE_TTL_SECONDS });
  });

  it("never serves a legacy entry to a different model", async () => {
    const url = "https://example.com/legacy-other";
    store.set(legacyCacheKeyForUrl(url), VALUE);
    process.env.MODEL_ID = "some-other-model";
    expect(await getCachedConversion(url)).toBeNull();
  });
});
