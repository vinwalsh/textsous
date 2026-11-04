import type { Metadata, Viewport } from "next";
import { parseEmbedRequest } from "../../lib/embed";
import { GLASSES_APP_NAME } from "../../lib/glasses";
import { glassesDemos } from "./demos";
import GlassesApp from "./GlassesApp";
import "./glasses.css";

export const metadata: Metadata = {
  title: "Cook Along on glasses · TextSous",
  description: "A heads-up TextSous cook along for Meta Ray-Ban Display.",
  applicationName: GLASSES_APP_NAME,
  robots: { index: false, follow: false },
  // Meta Ray-Ban Display (developer preview) runs pages that declare this.
  other: { "mrbd-web-app-capable": "yes" },
};

/** Light on black: on the glasses' additive display black is see-through. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
  colorScheme: "dark",
};

/**
 * Heads-up Cook Along for Meta Ray-Ban Display, chrome-less like /embed.
 * `?src=` (this site's signed artifact link) or `?url=` (a recipe page,
 * converted cache-first); with neither, a picker of the demo recipes.
 */
export default async function GlassesPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[]; src?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <main>
      <GlassesApp request={parseEmbedRequest(params)} demos={glassesDemos()} />
    </main>
  );
}
