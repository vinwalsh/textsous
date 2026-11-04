/** Pure handoff URL builders (client-safe: no node imports). */

/** Where "Save to TextSous" sends the cook with their signed artifact URL. */
export const TEXTSOUS_IMPORT_URL = "https://textsous.com/import";

export function buildSignedArtifactUrl(origin: string, id: string, sig: string): string {
  return `${origin}/api/artifact/${id}?sig=${sig}`;
}

export function buildImportUrl(signedArtifactUrl: string): string {
  return `${TEXTSOUS_IMPORT_URL}?src=${encodeURIComponent(signedArtifactUrl)}`;
}

/**
 * "Save to TextSous" needs textsous.com/import, which ships with the Cookbook
 * on textsous.com. Until then a deploy can hide the button by building with
 * NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off (also 0, false or no). Shown by default.
 */
export function saveToTextSousEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_SAVE_TO_TEXTSOUS,
): boolean {
  return !/^(off|0|false|no)$/i.test((value ?? "").trim());
}
