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

/** Cache key binds the normalized URL to the stage versions. */
export function cacheKeyForUrl(normalizedUrl: string): string {
  const v = stageVersions();
  const hash = createHash("sha256")
    .update(
      `canonicalize:v${v.canonicalize}:procedure:v${v.procedure}:scheduler:v${v.scheduler}:review:v${v.review}:compile:v${v.compile}:${normalizedUrl}`,
    )
    .digest("hex");
  return `textsous:convert:v2:${hash}`;
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
