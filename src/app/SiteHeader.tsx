import Link from "next/link";

export const GITHUB_URL = "https://github.com/vinwalsh/textsous";

/**
 * Wordmark, the "Open" pill and three short links, then one line of intro.
 * Rendered as a direct child of <body> with the class `site-header`: /embed
 * hides it with body:has(.ts-embed-root) > .site-header (embed-chrome.css).
 */
export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-header-row">
          <Link href="/" className="brand">
            <span className="wordmark">TextSous</span>{" "}
            <span className="open-pill">Open</span>
          </Link>
          <nav className="site-nav" aria-label="Site">
            <Link href="/demo">Demo</Link>
            <Link href="/assistants">Use in your assistant</Link>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
        </div>
        <p className="site-intro">Turn any recipe into a calm, step-by-step cook along.</p>
      </div>
    </header>
  );
}
