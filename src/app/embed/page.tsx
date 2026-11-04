import type { Metadata } from "next";
import { parseEmbedRequest } from "../../lib/embed";
import EmbedApp from "./EmbedApp";
import "./embed-chrome.css";

export const metadata: Metadata = {
  title: "Cook Along · TextSous",
  robots: { index: false, follow: false },
};

/**
 * Chrome-less converter + Cook Along viewer that embed.js opens in an
 * overlay on a recipe site. `?url=` converts (cache-first), `?src=` loads an
 * artifact. Framed by any site: see the headers in next.config.ts.
 */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[]; src?: string | string[] }>;
}) {
  const params = await searchParams;
  return <EmbedApp request={parseEmbedRequest(params)} />;
}
