"use client";

import { useEffect } from "react";

/**
 * React loads /embed.js once per document, so after a client-side navigation
 * (a Next <Link>, Back) the new page's placements were never scanned. This
 * asks the copy that already ran to pick them up. Before embed.js has loaded
 * it does nothing: the script's own first scan handles the page.
 */
export default function EmbedRescan() {
  useEffect(() => {
    (window as { TextSousEmbed?: { scan?: () => void } }).TextSousEmbed?.scan?.();
  }, []);
  return null;
}
