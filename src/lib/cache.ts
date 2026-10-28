import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { CanonicalRecipe } from "./schema/canonical";
import { CANONICALIZE_VERSION, type CanonicalizeCheck } from "./stages/canonicalize";

export interface CachedConversion {
  recipe: CanonicalRecipe;
  checks: CanonicalizeCheck[];
  cachedAt: string;
  versions: { canonicalize: number };
}

export function upstash(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Cache key binds the normalized URL to the stage versions. */
export function cacheKeyForUrl(normalizedUrl: string): string {
  const hash = createHash("sha256")
    .update(`canonicalize:v${CANONICALIZE_VERSION}:${normalizedUrl}`)
    .digest("hex");
  return `textsous:convert:v1:${hash}`;
}

const DEV_DIR = ".cache/convert";

export async function getCachedConversion(normalizedUrl: string): Promise<CachedConversion | null> {
  const key = cacheKeyForUrl(normalizedUrl);
  const redis = upstash();
  if (redis) {
    return (await redis.get<CachedConversion>(key)) ?? null;
  }
  try {
    const raw = await readFile(path.join(DEV_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as CachedConversion;
  } catch {
    return null;
  }
}

export async function setCachedConversion(
  normalizedUrl: string,
  value: CachedConversion,
): Promise<void> {
  const key = cacheKeyForUrl(normalizedUrl);
  const redis = upstash();
  if (redis) {
    await redis.set(key, value, { ex: 60 * 60 * 24 * 7 });
    return;
  }
  await mkdir(DEV_DIR, { recursive: true });
  await writeFile(path.join(DEV_DIR, `${key}.json`), JSON.stringify(value));
}
