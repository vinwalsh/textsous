/** A deterministic local display key, NOT a reviewed-source fingerprint or authorization. */
export function recipeDisplayIdentity(value: unknown): string {
  const text = JSON.stringify(value);
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < text.length; i++) for (let j = 0; j < hashes.length; j++) {
    hashes[j] = Math.imul(hashes[j] ^ (text.charCodeAt(i) + j), 16777619);
  }
  return `display-${hashes.map(hash => (hash >>> 0).toString(16).padStart(8, "0")).join("")}`;
}
