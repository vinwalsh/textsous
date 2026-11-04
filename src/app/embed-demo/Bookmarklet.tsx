"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import styles from "./demo.module.css";

/** The embed.js a bookmarklet loads: this site's own copy, so a preview tests its own build. Pure. */
export function bookmarkletScriptUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/embed.js`;
}

/**
 * What the bookmarklet runs on a recipe page: it adds embed.js with
 * data-floating and data-mode="adjust", so one "Adjust with SOUS" button
 * sits at the bottom right. Running it twice adds nothing more. Pure.
 */
export function bookmarkletCode(scriptUrl: string): string {
  return (
    "(function(){var d=document;" +
    "if(d.querySelector('[data-textsous-floating]'))return;" +
    "var s=d.createElement('script');" +
    `s.src=${JSON.stringify(scriptUrl)};` +
    "s.async=true;" +
    "s.setAttribute('data-floating','');" +
    "s.setAttribute('data-mode','adjust');" +
    "(d.body||d.documentElement).appendChild(s);})();void 0"
  );
}

/** The javascript: address for the bookmarks bar, percent-encoded (browsers decode it before running it). Pure. */
export function bookmarkletHref(scriptUrl: string): string {
  return `javascript:${encodeURIComponent(bookmarkletCode(scriptUrl))}`;
}

/**
 * "Try it on any recipe page": a link the reader drags to the bookmarks bar.
 * React refuses javascript: hrefs, so the address is set on the element
 * after it mounts, from this page's own origin.
 */
export default function Bookmarklet() {
  const link = useRef<HTMLAnchorElement>(null);
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    link.current?.setAttribute("href", bookmarkletHref(bookmarkletScriptUrl(window.location.origin)));
  }, []);

  // A click here would only run it on this demo page, which has its own button.
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setTapped(true);
  }

  return (
    <section className={styles.howto} aria-labelledby="try-anywhere" data-bookmarklet-section="">
      <h2 id="try-anywhere">Try it on any recipe page</h2>
      <p>
        Drag this button to your bookmarks bar. Then, on any recipe page, click the bookmark: an
        Adjust with SOUS button appears at the bottom right of that page. Change the servings,
        make it vegan, make it more Italian or open the Cook Along, all without leaving the page.
      </p>
      <p>
        <a ref={link} className={styles.bookmarklet} onClick={onClick}>
          Adjust with SOUS
        </a>
      </p>
      {tapped ? (
        <p role="status" className={styles.ctaNote}>
          Drag it to your bookmarks bar instead. Clicking it here does nothing.
        </p>
      ) : null}
      <p className={styles.ctaNote}>
        Some sites block outside scripts. On those, the button doesn&apos;t appear.
      </p>
    </section>
  );
}
