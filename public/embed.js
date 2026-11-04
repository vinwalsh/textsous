/*! TextSous Cook Along button. MIT License, (c) 2026 SOUS AI LLC.
 * Docs: https://github.com/vinwalsh/textsous/blob/main/docs/EMBED.md
 *
 * <script src="https://open.textsous.com/embed.js" async></script>
 * <div data-textsous-cook-along></div>   (optional placement; repeatable)
 *
 * Attributes (on a placement or on the script tag):
 *   data-recipe-url  recipe page to convert (default: <link rel="canonical">, else this page)
 *   data-src         a pre-converted artifact JSON URL (made with the TextSous CLI)
 *   data-label       button text (default "Cook along with TextSous")
 *   data-autoopen    open the overlay right away
 *
 * No cookies, no tracking, no dependencies. Safe to include more than once.
 */
(function () {
  "use strict";

  var w = typeof window !== "undefined" ? window : null;
  if (!w) return;
  var d = w.document || null;
  var thisScript = d ? d.currentScript : null;

  if (w.TextSousEmbed && w.TextSousEmbed.version) {
    // Included twice: reuse the first copy, pick up any new placements.
    if (d && typeof w.TextSousEmbed.scan === "function") w.TextSousEmbed.scan();
    return;
  }

  var VERSION = 1;
  var DEFAULT_ORIGIN = "https://open.textsous.com";
  var DEFAULT_LABEL = "Cook along with TextSous";
  var CLOSE = "textsous:close";
  var NEED_ARTIFACT = "textsous:need-artifact";
  var ARTIFACT = "textsous:artifact";
  var MAX_ARTIFACT_BYTES = 1024 * 1024;

  // ---------- pure helpers (unit-tested in tests/embed-script.test.ts) ----------

  /** Absolute recipe URL without its hash: explicit attribute, else canonical, else the page. */
  function resolveRecipeUrl(input) {
    var base = input.href;
    var candidates = [input.attr, input.canonical, input.href];
    for (var i = 0; i < candidates.length; i++) {
      var value = candidates[i];
      if (typeof value !== "string" || value.trim() === "") continue;
      try {
        var url = new URL(value.trim(), base);
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        url.hash = "";
        return url.toString();
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  }

  /** Absolute artifact URL for data-src, resolved against the page. */
  function resolveSrc(value, href) {
    if (typeof value !== "string" || value.trim() === "") return null;
    try {
      var url = new URL(value.trim(), href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  /** Origin the script was loaded from, so local and preview copies point at themselves. */
  function scriptOrigin(src) {
    if (typeof src === "string" && src) {
      try {
        var url = new URL(src);
        if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
      } catch {
        /* fall through */
      }
    }
    return DEFAULT_ORIGIN;
  }

  /** <origin>/embed?url=...|src=...&utm_source=<host>&utm_medium=embed */
  function buildFrameUrl(origin, opts) {
    var params = new URLSearchParams();
    if (opts.src) params.set("src", opts.src);
    else if (opts.url) params.set("url", opts.url);
    if (opts.host) params.set("utm_source", opts.host);
    params.set("utm_medium", "embed");
    return origin.replace(/\/$/, "") + "/embed?" + params.toString();
  }

  /** Message from our iframe's window and origin, with the expected type. */
  function isTrustedMessage(event, expectedOrigin, expectedSource, type) {
    if (!event || event.origin !== expectedOrigin) return false;
    if (expectedSource !== undefined && event.source !== expectedSource) return false;
    var data = event.data;
    return !!data && typeof data === "object" && data.type === type;
  }

  /** data-autoopen / boolean attributes: present and not "false" or "0". */
  function isOn(value) {
    if (value === null || value === undefined) return false;
    var v = String(value).trim().toLowerCase();
    return v !== "false" && v !== "0" && v !== "no";
  }

  var api = {
    version: VERSION,
    resolveRecipeUrl: resolveRecipeUrl,
    resolveSrc: resolveSrc,
    scriptOrigin: scriptOrigin,
    buildFrameUrl: buildFrameUrl,
    isTrustedMessage: isTrustedMessage,
    isOn: isOn,
  };
  w.TextSousEmbed = api;
  if (!d || typeof d.querySelectorAll !== "function") return;
  if (typeof Element === "undefined" || !Element.prototype.attachShadow) return; // old browser: keep the fallback link

  // ---------- page wiring ----------

  var script =
    thisScript ||
    (function () {
      var all = d.querySelectorAll('script[src*="/embed.js"]');
      return all.length ? all[all.length - 1] : null;
    })();
  var ORIGIN = scriptOrigin(script ? script.src : "");
  var READY = "data-textsous-ready";

  function attr(el, name) {
    if (el && el.hasAttribute && el.hasAttribute(name)) return el.getAttribute(name);
    if (script && script !== el && script.hasAttribute(name)) return script.getAttribute(name);
    return null;
  }

  function canonicalHref() {
    var link = d.querySelector('link[rel~="canonical"][href]');
    return link ? link.href : null;
  }

  function targetFor(el) {
    var src = resolveSrc(attr(el, "data-src"), w.location.href);
    if (src) return { src: src };
    return {
      url: resolveRecipeUrl({
        attr: attr(el, "data-recipe-url"),
        canonical: canonicalHref(),
        href: w.location.href,
      }),
    };
  }

  var BUTTON_CSS =
    ":host{display:inline-block}" +
    "button{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;gap:.5em;" +
    "padding:.7em 1.2em;border-radius:30px;background:#B74725;color:#fff;cursor:pointer;" +
    "font:600 16px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}" +
    "button:hover{background:#9D3D20}" +
    "button:focus-visible{outline:3px solid #D45A35;outline-offset:2px}" +
    "svg{width:1.1em;height:1.1em;flex:none}";

  var ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><path d="M4 7h9M4 12h14M4 17h6"/></svg>';

  function makeButton(el) {
    var host;
    var root;
    try {
      root = el.attachShadow({ mode: "open" }); // placement content becomes the no-JS fallback
      host = el;
    } catch {
      host = d.createElement("span");
      el.appendChild(host);
      root = host.attachShadow({ mode: "open" });
    }
    var style = d.createElement("style");
    style.textContent = BUTTON_CSS;
    var button = d.createElement("button");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.innerHTML = ICON;
    button.appendChild(d.createTextNode(attr(el, "data-label") || DEFAULT_LABEL));
    button.addEventListener("click", function () {
      open(targetFor(el), button);
    });
    root.appendChild(style);
    root.appendChild(button);
    return host;
  }

  var OVERLAY_CSS =
    ":host{all:initial}" +
    ".backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(34,32,28,.55);" +
    "display:flex;align-items:center;justify-content:center}" +
    ".dialog{box-sizing:border-box;display:flex;flex-direction:column;background:#FAF8F5;" +
    "width:min(960px,calc(100vw - 48px));height:calc(100vh - 48px);height:calc(100dvh - 48px);" +
    "border-radius:10px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.3)}" +
    ".bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 8px 8px 16px;" +
    "border-bottom:1px solid #E2DBD5;background:#FFFFFF;" +
    "font:600 15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#22201C}" +
    ".close{all:initial;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" +
    "padding:8px 14px;border-radius:30px;background:#F1EBE4;color:#22201C;" +
    "font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}" +
    ".close:hover{background:#E2DBD5}" +
    ".close:focus-visible{outline:3px solid #D45A35;outline-offset:2px}" +
    "iframe{flex:1;width:100%;border:0;background:#FAF8F5}" +
    "@media (max-width:640px){.dialog{width:100vw;height:100vh;height:100dvh;border-radius:0}}";

  var state = null; // { host, iframe, closeButton, returnFocus, src, saved }

  function lockScroll() {
    var html = d.documentElement;
    var body = d.body;
    var saved = {
      html: html.style.overflow,
      body: body ? body.style.overflow : "",
    };
    html.style.overflow = "hidden";
    if (body) body.style.overflow = "hidden";
    return saved;
  }

  function unlockScroll(saved) {
    d.documentElement.style.overflow = saved.html;
    if (d.body) d.body.style.overflow = saved.body;
  }

  function onKeydown(event) {
    if (state && (event.key === "Escape" || event.key === "Esc")) {
      event.preventDefault();
      close();
    }
  }

  function answerArtifact(src) {
    var frame = state && state.iframe;
    function reply(message) {
      if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, ORIGIN);
    }
    w.fetch(src, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.text();
      })
      .then(function (text) {
        if (text.length > MAX_ARTIFACT_BYTES) throw new Error("too large");
        reply({ type: ARTIFACT, src: src, artifact: JSON.parse(text) });
      })
      .catch(function (error) {
        reply({ type: ARTIFACT, src: src, error: String((error && error.message) || error) });
      });
  }

  function onMessage(event) {
    if (!state) return;
    var source = state.iframe.contentWindow;
    if (isTrustedMessage(event, ORIGIN, source, CLOSE)) {
      close();
      return;
    }
    if (isTrustedMessage(event, ORIGIN, source, NEED_ARTIFACT)) {
      // Only the artifact this overlay was opened for: the page fetches it with its own access.
      if (state.src && event.data.src === state.src) answerArtifact(state.src);
    }
  }

  function open(target, returnFocus) {
    if (state) close();
    if (!target || (!target.url && !target.src)) return;
    var host = d.createElement("div");
    host.setAttribute("data-textsous-overlay", "");
    var root = host.attachShadow({ mode: "open" });
    var style = d.createElement("style");
    style.textContent = OVERLAY_CSS;

    var backdrop = d.createElement("div");
    backdrop.className = "backdrop";
    var dialog = d.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Cook Along with TextSous");

    var bar = d.createElement("div");
    bar.className = "bar";
    var title = d.createElement("span");
    title.textContent = "TextSous Cook Along";
    var closeButton = d.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.setAttribute("aria-label", "Close Cook Along");
    closeButton.textContent = "✕ Close";
    closeButton.addEventListener("click", close);
    bar.appendChild(title);
    bar.appendChild(closeButton);

    var iframe = d.createElement("iframe");
    iframe.title = "TextSous Cook Along";
    iframe.src = buildFrameUrl(ORIGIN, {
      url: target.url,
      src: target.src,
      host: w.location.hostname,
    });

    dialog.appendChild(bar);
    dialog.appendChild(iframe);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) close();
    });
    root.appendChild(style);
    root.appendChild(backdrop);
    d.body.appendChild(host);

    state = {
      host: host,
      iframe: iframe,
      closeButton: closeButton,
      returnFocus: returnFocus || d.activeElement,
      src: target.src || null,
      saved: lockScroll(),
    };
    d.addEventListener("keydown", onKeydown, true);
    w.addEventListener("message", onMessage);
    closeButton.focus();
  }

  function close() {
    if (!state) return;
    var current = state;
    state = null;
    d.removeEventListener("keydown", onKeydown, true);
    w.removeEventListener("message", onMessage);
    unlockScroll(current.saved);
    if (current.host.parentNode) current.host.parentNode.removeChild(current.host);
    if (current.returnFocus && typeof current.returnFocus.focus === "function") {
      try {
        current.returnFocus.focus();
      } catch {
        /* element gone */
      }
    }
  }

  function scan() {
    var placements = d.querySelectorAll("[data-textsous-cook-along]");
    var autoTarget = null;
    if (placements.length > 0) {
      for (var i = 0; i < placements.length; i++) {
        var el = placements[i];
        if (el.hasAttribute(READY)) continue;
        el.setAttribute(READY, "");
        makeButton(el);
        if (!autoTarget && isOn(attr(el, "data-autoopen"))) autoTarget = targetFor(el);
      }
    } else if (script && !script.hasAttribute(READY) && !d.querySelector("[data-textsous-script-button]")) {
      script.setAttribute(READY, "");
      var span = d.createElement("span");
      span.setAttribute("data-textsous-script-button", "");
      if (script.parentNode) script.parentNode.insertBefore(span, script.nextSibling);
      if (span.parentNode && span.parentNode !== d.head) {
        makeButton(span);
        if (isOn(script.getAttribute("data-autoopen"))) autoTarget = targetFor(script);
      } else if (span.parentNode) {
        span.parentNode.removeChild(span); // script in <head> and no placement: nothing to show
      }
    }
    if (autoTarget && !state) open(autoTarget, null);
  }

  api.scan = scan;
  api.open = function (opts) {
    var o = opts || {};
    var src = resolveSrc(o.src, w.location.href);
    open(
      src
        ? { src: src }
        : { url: resolveRecipeUrl({ attr: o.url, canonical: canonicalHref(), href: w.location.href }) },
    );
  };
  api.close = close;

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
