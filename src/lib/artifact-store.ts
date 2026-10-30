import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { upstash } from "./cache";
import { CookAlongArtifactSchema, type CookAlongArtifact } from "./schema/artifact";

/** Signed artifact URLs work for 24 hours and may be fetched more than once. */
export const ARTIFACT_TTL_SECONDS = 24 * 60 * 60;

const DEV_DIR = ".cache/artifacts";
const STORE_PREFIX = "textsous:artifact:v1:";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StoredArtifact {
  artifact: CookAlongArtifact;
  /** Unix seconds when the signed URL stops working. */
  expiresAt: number;
}

export interface SavedArtifact extends StoredArtifact {
  id: string;
}

export function artifactSigningSecret(): string {
  const secret = process.env.ARTIFACT_SIGNING_SECRET;
  if (!secret) {
    throw new Error("Artifact signing is not configured: set ARTIFACT_SIGNING_SECRET.");
  }
  return secret;
}

/** HMAC of the id and expiry, hex-encoded. */
export function signArtifactId(id: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`${id}.${expiresAt}`).digest("hex");
}

/** Constant-time signature check. Any malformed input fails closed. */
export function verifyArtifactSignature(
  id: string,
  expiresAt: number,
  sig: string,
  secret: string,
): boolean {
  const expected = signArtifactId(id, expiresAt, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Ids are UUIDs we generated; anything else is rejected before touching storage. */
export function isArtifactId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function storeDir(): string {
  return process.env.ARTIFACT_STORE_DIR ?? DEV_DIR;
}

function isValidRecord(value: unknown): value is StoredArtifact {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { artifact?: unknown; expiresAt?: unknown };
  if (typeof record.expiresAt !== "number") return false;
  return CookAlongArtifactSchema.safeParse(record.artifact).success;
}

/**
 * Store an artifact under a random id. Upstash in prod (native TTL),
 * filesystem in dev. Corrupt or expired records read back as null.
 */
export async function saveArtifact(
  artifact: CookAlongArtifact,
  opts: { ttlSeconds?: number } = {},
): Promise<SavedArtifact> {
  const id = randomUUID();
  const ttl = opts.ttlSeconds ?? ARTIFACT_TTL_SECONDS;
  const record: StoredArtifact = {
    artifact,
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
  };
  const redis = upstash();
  if (redis) {
    await redis.set(`${STORE_PREFIX}${id}`, record, { ex: Math.max(1, ttl) });
    return { id, ...record };
  }
  const dir = storeDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(record));
  return { id, ...record };
}

export async function loadArtifact(id: string): Promise<StoredArtifact | null> {
  if (!isArtifactId(id)) return null;
  const redis = upstash();
  if (redis) {
    const record: unknown = await redis.get(`${STORE_PREFIX}${id}`);
    if (!isValidRecord(record)) return null;
    return record.expiresAt * 1000 > Date.now() ? record : null;
  }
  const file = path.join(storeDir(), `${id}.json`);
  let record: StoredArtifact;
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidRecord(parsed)) return null;
    record = parsed;
  } catch {
    return null;
  }
  if (record.expiresAt * 1000 <= Date.now()) {
    await unlink(file).catch(() => {});
    return null;
  }
  return record;
}
