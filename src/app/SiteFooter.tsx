export const LICENSE_URL = "https://github.com/vinwalsh/textsous/blob/main/LICENSE";
export const PRIVACY_URL = "https://textsous.com/privacy";
export const TAKEDOWN_EMAIL = "privacy@textsous.com";

/** License, privacy and takedown links, then the privacy note. Hidden on /embed. */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="site-footer-links">
          <a href={LICENSE_URL}>Open source (MIT)</a> by SOUS AI LLC
          <span aria-hidden="true"> · </span>
          <a href={PRIVACY_URL}>Privacy</a>
          <span aria-hidden="true"> · </span>
          <a href={`mailto:${TAKEDOWN_EMAIL}`} title={`Recipe takedown requests: ${TAKEDOWN_EMAIL}`}>
            Takedowns
          </a>
        </p>
        <p>
          Converted recipes are private to you: they are never listed, indexed, or shared,
          and photos are processed in memory and never stored. Recipe takedown requests:{" "}
          <a href={`mailto:${TAKEDOWN_EMAIL}`}>{TAKEDOWN_EMAIL}</a>.
        </p>
      </div>
    </footer>
  );
}
