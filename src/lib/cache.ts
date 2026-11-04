import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { CookAlongArtifact } from "./schema/artifact";
import type { ScheduleResult } from "./scheduler/schedule";
import { CANONICALIZE_VERSION } from "./stages/canonicalize";
import { COMPILE_VERSION } from "./stages/compile";
import { PROCEDURE_VERSION } from "./stages/procedure";
import { REVIEW_VERSION } from "./stages/review";
import { SCHEDULER_VERSION } from "./scheduler/schedule";
import { META_DEFAULT_MODEL, resolveProvider } from "./model/profiles";

/** Conversions stay cached for 30 days (judging runs past a 7-day TTL). */
export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface StageVersions {
  canonicalize: number;
  procedure: number;
  scheduler: number;
  review: number;
  compile: number;
}

export function stageVersions(): StageVersions {
  return {
    canonicalize: CANONICALIZE_VERSION,
    procedure: PROCEDURE_VERSION,
    scheduler: SCHEDULER_VERSION,
    review: REVIEW_VERSION,
    compile: COMPILE_VERSION,
  };
}

export interface CachedConversion {
  artifact: CookAlongArtifact;
  schedule: ScheduleResult;
  cachedAt: string;
  versions: StageVersions;
  checksPassed: boolean;
}

export function upstash(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Model the live conversion route uses (MODEL_ID, default muse-spark-1.3). */
export function cacheModelId(): string {
  return resolveProvider("meta").model;
}

/** Cache key binds the normalized URL to the stage versions and the model id. */
export function cacheKeyForUrl(normalizedUrl: string, modelId = cacheModelId()): string {
  const v = stageVersions();
  const hash = createHash("sha256")
    .update(
      `model:${modelId}:canonicalize:v${v.canonicalize}:procedure:v${v.procedure}:scheduler:v${v.scheduler}:review:v${v.review}:compile:v${v.compile}:${normalizedUrl}`,
    )
    .digest("hex");
  return `textsous:convert:v3:${hash}`;
}

/**
 * Key used before the model id joined the key (always the default model in
 * production). Read once as a fallback so the warm cache survives the key
 * change; a hit is copied to the new key with the new TTL.
 */
export function legacyCacheKeyForUrl(normalizedUrl: string): string {
  const v = stageVersions();
  const hash = createHash("sha256")
    .update(
      `canonicalize:v${v.canonicalize}:procedure:v${v.procedure}:scheduler:v${v.scheduler}:review:v${v.review}:compile:v${v.compile}:${normalizedUrl}`,
    )
    .digest("hex");
  return `textsous:convert:v2:${hash}`;
}

const DEV_DIR = ".cache/convert";

async function readKey(key: string): Promise<CachedConversion | null> {
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

async function writeKey(key: string, value: CachedConversion): Promise<void> {
  const redis = upstash();
  if (redis) {
    await redis.set(key, value, { ex: CACHE_TTL_SECONDS });
    return;
  }
  await mkdir(DEV_DIR, { recursive: true });
  await writeFile(path.join(DEV_DIR, `${key}.json`), JSON.stringify(value));
}

export async function getCachedConversion(normalizedUrl: string): Promise<CachedConversion | null> {
  const modelId = cacheModelId();
  const hit = await readKey(cacheKeyForUrl(normalizedUrl, modelId));
  if (hit) return hit;
  if (modelId !== META_DEFAULT_MODEL) return null;
  const legacy = await readKey(legacyCacheKeyForUrl(normalizedUrl));
  if (!legacy) return null;
  await writeKey(cacheKeyForUrl(normalizedUrl, modelId), legacy).catch(() => {});
  return legacy;
}

export async function setCachedConversion(
  normalizedUrl: string,
  value: CachedConversion,
): Promise<void> {
  await writeKey(cacheKeyForUrl(normalizedUrl), value);
}
