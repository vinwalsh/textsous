import { DEMO_RECIPE, demoJsonLd } from "./recipe";
import styles from "./demo.module.css";

export const PUBLIC_ORIGIN = "https://open.textsous.com";

export const EMBED_SNIPPET = `<script src="${PUBLIC_ORIGIN}/embed.js" async></script>
<div data-textsous-cook-along></div>`;

/** Accept only this site's own signed artifact links as a demo data-src. */
export function demoSrc(raw: string | undefined, origin: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/artifact/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Plain /embed-demo converts its own address, which only works on production. */
const PRODUCTION_ORIGIN = "https://open.textsous.com";

/**
 * A plain recipe blog post with the Cook Along button, for demos and the
 * hackathon video. The page itself loads /embed.js from its own origin so a
 * local or preview build shows its own overlay.
 */
export default function DemoPost({
  origin,
  src,
  autoOpen,
}: {
  origin: string;
  src: string | null;
  autoOpen: boolean;
}) {
  const pageUrl = `${origin}/embed-demo`;
  const ld = JSON.stringify(demoJsonLd(pageUrl)).replace(/</g, "\\u003c");
  const placement: Record<string, string> = { "data-textsous-cook-along": "" };
  if (src) placement["data-src"] = src;
  if (autoOpen) placement["data-autoopen"] = "";
  const starts = DEMO_RECIPE.sections.map((_, i) =>
    DEMO_RECIPE.sections.slice(0, i).reduce((n, section) => n + section.steps.length, 1),
  );

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <p className={styles.banner} role="note">
        <strong>Demo page.</strong> A sample recipe blog post that shows the TextSous Cook Along
        button. The recipe is an original written for this project (CC0).
        {src || origin === PRODUCTION_ORIGIN ? null : (
          <>
            {" "}
            <span data-demo-test-note="">
              On this build the button can&apos;t convert this page (it only converts on{" "}
              {PRODUCTION_ORIGIN}). Add <code>?src=&lt;saved artifact link&gt;&amp;autoopen=1</code> to
              test the overlay.
            </span>
          </>
        )}
      </p>
      <header className={styles.blogHeader}>
        <span className={styles.blogName}>The Demo Kitchen</span>
        <span className={styles.blogNav}>Recipes · About</span>
      </header>
      <article className={styles.post}>
        <h1 className={styles.title}>{DEMO_RECIPE.title}</h1>
        <p className={styles.byline}>
          By {DEMO_RECIPE.author} · Serves {DEMO_RECIPE.yield.replace(" servings", "")}
        </p>
        <p>{DEMO_RECIPE.intro}</p>

        <div className={styles.cta}>
          <div {...placement}>
            <a href={`${origin}/?url=${encodeURIComponent(pageUrl)}`}>Open with TextSous</a>
          </div>
          <p className={styles.ctaNote}>
            Cook it step by step with timers, right here on this page.
          </p>
        </div>

        <h2>Ingredients</h2>
        <ul>
          {DEMO_RECIPE.ingredients.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <h2>Instructions</h2>
        {DEMO_RECIPE.sections.map((section, i) => (
          <div key={i}>
            {section.name ? <h3>{section.name}</h3> : null}
            <ol start={starts[i]}>
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
        <p className={styles.license}>
          Recipe by {DEMO_RECIPE.author}, released under{" "}
          <a href={DEMO_RECIPE.license}>CC0 1.0</a>.
        </p>
      </article>

      <section className={styles.howto} aria-label="Add this button to your site">
        <h2>Add this button to your recipe site</h2>
        <p>Paste this where the button should appear:</p>
        <pre className={styles.snippet}>
          <code>{EMBED_SNIPPET}</code>
        </pre>
        <p>
          Readers stay on your page: the Cook Along opens in an overlay. See{" "}
          <a href="https://github.com/vinwalsh/textsous/blob/main/docs/EMBED.md">docs/EMBED.md</a>{" "}
          for the options.
        </p>
      </section>
      <script src="/embed.js" async />
    </div>
  );
}
