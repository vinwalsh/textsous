import { createHash } from "node:crypto";

/** Stable content fingerprint, e.g. for `sourceFingerprint`. */
export function fingerprintSource(parts: string[]): string {
  const normalized = parts
    .map((p) => p.trim().replace(/\s+/g, " ").toLowerCase())
    .join("\n");
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}
