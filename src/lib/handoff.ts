/** Pure handoff URL builders (client-safe: no node imports). */

/** Where "Save to TextSous" sends the cook with their signed artifact URL. */
export const TEXTSOUS_IMPORT_URL = "https://textsous.com/import";

export function buildSignedArtifactUrl(origin: string, id: string, sig: string): string {
  return `${origin}/api/artifact/${id}?sig=${sig}`;
}

export function buildImportUrl(signedArtifactUrl: string): string {
  return `${TEXTSOUS_IMPORT_URL}?src=${encodeURIComponent(signedArtifactUrl)}`;
}
