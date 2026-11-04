import type { Metadata } from "next";
import { parseEmbedRequest, type EmbedParams } from "../../lib/embed";
import EmbedApp from "./EmbedApp";
import "./embed-chrome.css";

export const metadata: Metadata = {
  title: "Cook Along · TextSous",
  robots: { index: false, follow: false },
};

/**
 * Chrome-less converter + Cook Along viewer that embed.js opens in an
 * overlay on a recipe site. `?url=` converts (cache-first), `?src=` loads an
 * artifact. `?servings=`, `?dietary=` and `?cuisine=` (the "Adjust with
 * SOUS" menu) apply as soon as the cook along is ready; invalid ones are
 * ignored. Framed by any site: see the headers in next.config.ts.
 */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<EmbedParams>;
}) {
  const params = await searchParams;
  return <EmbedApp request={parseEmbedRequest(params)} />;
}
