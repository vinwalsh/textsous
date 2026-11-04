import type { Metadata } from "next";
import { headers } from "next/headers";
import DemoPost, { demoSrc } from "./DemoPost";

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "open.textsous.com";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  return {
    title: "Toasted Oat Porridge with Brown Butter Apples · Demo recipe post",
    description: "Demo page: a sample recipe blog post showing the TextSous Cook Along button.",
    alternates: { canonical: `${origin}/embed-demo` },
  };
}

/** `?src=` (this site's signed artifact link) and `?autoopen=1` drive screenshots. */
export default async function EmbedDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; autoopen?: string }>;
}) {
  const params = await searchParams;
  const origin = await requestOrigin();
  return (
    <DemoPost
      origin={origin}
      src={demoSrc(params.src, origin)}
      autoOpen={params.autoopen === "1" || params.autoopen === "true"}
    />
  );
}
