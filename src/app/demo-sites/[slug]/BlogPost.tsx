import type { Metadata } from "next";
import Link from "next/link";
import {
  DEMO_SITE_BYLINE,
  DEMO_SITE_LICENSE,
  blogFor,
  demoSiteJsonLd,
  demoSiteUrl,
  displayDuration,
  type DemoSiteRecipe,
} from "../recipes";
import styles from "../demo-sites.module.css";

export const DEMO_BANNER = "Demo: a pretend recipe blog with the TextSous button";

/** The button converts the page's own address, which works only on production. */
const PRODUCTION_ORIGIN = "https://open.textsous.com";

/** Title, canonical link and og:site_name (the credit's site name) for one blog post. */
export function demoSiteMetadata(recipe: DemoSiteRecipe, origin: string): Metadata {
  const blog = blogFor(recipe);
  return {
    title: `${recipe.title} · ${blog.name}`,
    description: `${recipe.summary} A pretend recipe blog for the TextSous demo.`,
    alternates: { canonical: demoSiteUrl(origin, recipe.slug) },
    openGraph: { siteName: blog.name, title: recipe.title, type: "article" },
  };
}

/** Decorative hero drawn with plain shapes: no photos, nothing third-party. */
function HeroArt({ art }: { art: DemoSiteRecipe["art"] }) {
  const common = {
    className: styles.heroArt,
    viewBox: "0 0 320 160",
    "aria-hidden": true,
    focusable: false,
  };
  if (art === "muffins") {
    return (
      <svg {...common}>
        {[80, 160, 240].map((x) => (
          <g key={x} transform={`translate(${x} 92)`}>
            <path d="M-30 0 H30 L23 44 H-23 Z" fill="#F2B8A6" />
            <path d="M-15 0 L-12 44 M0 0 V44 M15 0 L12 44" stroke="#E39C88" strokeWidth="3" />
            <path d="M-36 4 C-38 -34 38 -34 36 4 Z" fill="#E9B872" />
            <circle cx="-14" cy="-12" r="5" fill="#4A4F8C" />
            <circle cx="8" cy="-18" r="5" fill="#4A4F8C" />
            <circle cx="18" cy="-4" r="4.5" fill="#4A4F8C" />
            <circle cx="-2" cy="-4" r="2.5" fill="#FFF6E0" />
          </g>
        ))}
      </svg>
    );
  }
  if (art === "sheet-pan") {
    return (
      <svg {...common}>
        <rect x="34" y="26" width="252" height="112" rx="16" fill="#9AA3A8" />
        <rect x="44" y="36" width="232" height="92" rx="10" fill="#B9C1C5" />
        {[
          [90, 66],
          [160, 60],
          [230, 70],
          [120, 104],
          [200, 102],
        ].map(([cx, cy]) => (
          <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="26" ry="17" fill="#C9772F" />
        ))}
        {[
          [62, 100],
          [150, 88],
          [252, 104],
          [256, 54],
          [64, 52],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="11" fill="#E8BE5C" />
        ))}
        <path d="M188 46 q10 -8 20 0" stroke="#7E3B6E" strokeWidth="5" fill="none" />
        <path d="M100 118 q10 -8 20 0" stroke="#7E3B6E" strokeWidth="5" fill="none" />
        <circle cx="228" cy="96" r="4" fill="#5E8C4A" />
        <circle cx="136" cy="72" r="4" fill="#5E8C4A" />
      </svg>
    );
  }
  if (art === "skillet") {
    return (
      <svg {...common}>
        <rect x="200" y="72" width="104" height="18" rx="9" fill="#2E2925" />
        <circle cx="140" cy="81" r="66" fill="#2E2925" />
        <circle cx="140" cy="81" r="56" fill="#E2A947" />
        <path d="M140 81 L140 25 M140 81 L188 109 M140 81 L92 109" stroke="#C78C2C" strokeWidth="3" />
        <rect x="128" y="70" width="24" height="18" rx="4" fill="#F7E7A6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M112 36 c-8 -10 8 -16 0 -26 M160 32 c-8 -10 8 -16 0 -26 M208 36 c-8 -10 8 -16 0 -26" stroke="#B9A08A" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M62 66 H258 C258 118 214 146 160 146 C106 146 62 118 62 66 Z" fill="#B5452B" />
      <ellipse cx="160" cy="66" rx="98" ry="20" fill="#8F2F1C" />
      <ellipse cx="146" cy="62" rx="20" ry="8" fill="#FBF6EE" />
      <path d="M176 58 l14 4 M186 70 l12 -2 M120 72 l14 2" stroke="#E7B43C" strokeWidth="4" strokeLinecap="round" />
      <circle cx="112" cy="60" r="4" fill="#6A9A4B" />
      <circle cx="198" cy="62" r="4" fill="#6A9A4B" />
      <circle cx="170" cy="74" r="4" fill="#6A9A4B" />
    </svg>
  );
}

/**
 * One pretend recipe blog post for /demo-sites/<slug>: the demo banner, the
 * blog's own header, the post, the recipe card and the Adjust with SOUS
 * placements (embed.js turns each `data-textsous-adjust` into the button).
 * The root's `ts-demo-site-root` class hides the TextSous header and footer
 * (blog-chrome.css), so the page reads like a third-party blog. It loads
 * /embed.js from its own origin, like /embed-demo, so a local or preview
 * build shows its own overlay.
 */
export default function BlogPost({ recipe, origin }: { recipe: DemoSiteRecipe; origin: string }) {
  const blog = blogFor(recipe);
  const pageUrl = demoSiteUrl(origin, recipe.slug);
  const ld = JSON.stringify(demoSiteJsonLd(recipe, pageUrl)).replace(/</g, "\\u003c");
  const times: [string, string][] = [
    ["Yield", recipe.yield],
    ["Prep", displayDuration(recipe.prepMinutes)],
    ["Cook", displayDuration(recipe.cookMinutes)],
    ["Total", displayDuration(recipe.totalMinutes)],
  ];

  return (
    <div className={`ts-demo-site-root ${styles.site} ${styles[blog.id]}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <p className={styles.banner} role="note">
        {DEMO_BANNER}. <Link href="/demo-sites">All demo blogs</Link>
        {origin === PRODUCTION_ORIGIN ? null : (
          <span className={styles.bannerNote} data-demo-test-note="">
            On this build the button can&apos;t convert this page: it converts only on {PRODUCTION_ORIGIN}.
          </span>
        )}
      </p>

      <header className={styles.blogHeader}>
        <p className={styles.blogName}>{blog.name}</p>
        <p className={styles.blogTagline}>{blog.tagline}</p>
      </header>

      <main className={styles.main}>
        <article className={styles.post}>
          <p className={styles.kicker}>{recipe.category}</p>
          <h1 className={styles.title}>{recipe.title}</h1>
          <p className={styles.byline}>{DEMO_SITE_BYLINE}</p>

          <div className={styles.actions}>
            <a className={styles.jump} href="#recipe">
              Jump to recipe
            </a>
            <div data-textsous-adjust="" />
          </div>

          <div className={styles.hero}>
            <HeroArt art={recipe.art} />
          </div>

          {recipe.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          <section id="recipe" className={styles.card} aria-labelledby="recipe-card-title">
            <h2 id="recipe-card-title" className={styles.cardTitle}>
              {recipe.title}
            </h2>
            <dl className={styles.facts}>
              {times.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.cardAdjust}>
              <div data-textsous-adjust="" />
            </div>

            <h3>Ingredients</h3>
            {recipe.ingredients.map((group, i) => (
              <div key={group.heading ?? i}>
                {group.heading ? <h4 className={styles.groupHeading}>{group.heading}</h4> : null}
                <ul className={styles.ingredients}>
                  {group.items.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}

            <h3>Instructions</h3>
            <ol className={styles.steps}>
              {recipe.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <h3>Notes</h3>
            <ul className={styles.notes}>
              {recipe.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>

            <p className={styles.license}>
              {DEMO_SITE_BYLINE}, released under <a href={DEMO_SITE_LICENSE}>CC0 1.0</a>.
            </p>
          </section>
        </article>
      </main>

      <footer className={styles.blogFooter}>
        <p>
          {blog.name} is a pretend blog made for the TextSous demo.{" "}
          <Link href="/demo-sites">See all the demo blogs</Link>
        </p>
      </footer>
      <script src="/embed.js" async />
    </div>
  );
}
