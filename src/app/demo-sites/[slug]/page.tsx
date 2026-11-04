import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestOrigin } from "../origin";
import { demoSiteBySlug } from "../recipes";
import BlogPost, { demoSiteMetadata } from "./BlogPost";
import "./blog-chrome.css";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const recipe = demoSiteBySlug((await params).slug);
  if (!recipe) return {};
  return demoSiteMetadata(recipe, await requestOrigin());
}

/**
 * A pretend recipe blog post with the Adjust with SOUS button (the four
 * posts are in ../recipes.ts). The button converts this page's canonical
 * address, so it works on https://open.textsous.com.
 */
export default async function DemoSitePage({ params }: { params: Params }) {
  const recipe = demoSiteBySlug((await params).slug);
  if (!recipe) notFound();
  return <BlogPost recipe={recipe} origin={await requestOrigin()} />;
}
