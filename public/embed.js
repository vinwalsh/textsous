/*! TextSous Cook Along button. MIT License, (c) 2026 SOUS AI LLC.
 * Docs: https://github.com/vinwalsh/textsous/blob/main/docs/EMBED.md
 *
 * <script src="https://open.textsous.com/embed.js" async></script>
 * <div data-textsous-cook-along></div>   (optional placement; repeatable)
 *
 * Attributes (on a placement or on the script tag; a placement's own attribute wins):
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

  /**
   * Origins our iframe may speak from: the script's own origin, plus its https twin when the
   * script was loaded over http (the host then redirects /embed to https).
   */
  function trustedOrigins(origin) {
    var list = [origin];
    if (typeof origin === "string" && origin.indexOf("http://") === 0) list.push("https://" + origin.slice(7));
    return list;
  }

  /** Message from our iframe's window and origin (or one of several origins), with the expected type. */
  function isTrustedMessage(event, expectedOrigin, expectedSource, type) {
    var origins = Array.isArray(expectedOrigin) ? expectedOrigin : [expectedOrigin];
    if (!event || origins.indexOf(event.origin) === -1) return false;
    if (expectedSource !== undefined && event.source !== expectedSource) return false;
    var data = event.data;
    return !!data && typeof data === "object" && data.type === type;
  }

  /**
   * What a placement opens. The placement's own attributes win over the script tag's:
   * own data-src, own data-recipe-url, then the script's data-src, the script's
   * data-recipe-url, then the canonical link or the page.
   */
  function pickTarget(input) {
    var own = input.own || {};
    var shared = input.script || {};
    var href = input.href;
    var src = resolveSrc(own.src, href);
    if (src) return { src: src };
    var ownUrl = resolveSrc(own.recipeUrl, href); // only a valid web address counts as the placement's own
    if (ownUrl) return { url: resolveRecipeUrl({ attr: ownUrl, canonical: null, href: href }) };
    src = resolveSrc(shared.src, href);
    if (src) return { src: src };
    return { url: resolveRecipeUrl({ attr: shared.recipeUrl, canonical: input.canonical, href: href }) };
  }

  /** Page elements to make inert behind the open overlay: body children except ours and non-visual ones. */
  function backgroundElements(children, overlayHost) {
    var out = [];
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (!el || el === overlayHost || el.nodeType !== 1) continue;
      var tag = String(el.tagName || "").toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE" || tag === "NOSCRIPT") continue;
      if (el.hasAttribute && el.hasAttribute("inert")) continue; // already inert: leave it as the page set it
      out.push(el);
    }
    return out;
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
    trustedOrigins: trustedOrigins,
    pickTarget: pickTarget,
    backgroundElements: backgroundElements,
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
  var ORIGINS = trustedOrigins(ORIGIN);
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

  function ownAttr(el, name) {
    return el && el.hasAttribute && el.hasAttribute(name) ? el.getAttribute(name) : null;
  }

  function targetFor(el) {
    var shared = script && script !== el ? script : null;
    return pickTarget({
      own: { src: ownAttr(el, "data-src"), recipeUrl: ownAttr(el, "data-recipe-url") },
      script: { src: ownAttr(shared, "data-src"), recipeUrl: ownAttr(shared, "data-recipe-url") },
      canonical: canonicalHref(),
      href: w.location.href,
    });
  }

  // TextSous colors (--ts-action #B74725, hover #9D3D20, focus --ts-accent #D45A35) and font:
  // Inter where the reader has it, else the system UI font. No web font is loaded on the host page.
  var FONT = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

  var BUTTON_CSS =
    ":host{display:inline-block}" +
    "button{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;gap:.5em;" +
    "min-height:44px;padding:.7em 1.2em;border-radius:30px;background:#B74725;color:#fff;cursor:pointer;" +
    "font:600 16px/1.2 " + FONT + "}" +
    "button:hover{background:#9D3D20}" +
    "button:focus-visible{outline:2px solid #D45A35;outline-offset:2px}" +
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
    "font:600 15px/1.3 " + FONT + ";color:#22201C}" +
    ".close{all:initial;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" +
    "min-height:44px;padding:10px 16px;border:1px solid #E2DBD5;border-radius:30px;background:#FFFFFF;color:#22201C;" +
    "font:600 15px/1 " + FONT + "}" +
    ".close:hover{background:#F1EBE4}" +
    ".close:focus-visible{outline:2px solid #D45A35;outline-offset:2px}" +
    "iframe{flex:1;width:100%;border:0;background:#FAF8F5}" +
    ".sentinel{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0}" +
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

  function sentinel(onFocus) {
    var el = d.createElement("span");
    el.className = "sentinel";
    el.tabIndex = 0;
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("focus", onFocus);
    return el;
  }

  /** aria-modal alone isn't honored everywhere (or inside a shadow root): make the page behind inert. */
  function makeBackgroundInert(overlayHost) {
    var els = backgroundElements(d.body ? d.body.children : [], overlayHost);
    for (var i = 0; i < els.length; i++) {
      els[i].setAttribute("inert", "");
    }
    return els;
  }

  function restoreBackground(els) {
    for (var i = 0; i < (els || []).length; i++) {
      els[i].removeAttribute("inert");
    }
  }

  function onKeydown(event) {
    if (state && (event.key === "Escape" || event.key === "Esc")) {
      event.preventDefault();
      close();
    }
  }

  function answerArtifact(src, frameOrigin) {
    var frame = state && state.iframe;
    function reply(message) {
      // frameOrigin is the asking message's origin, already checked against ORIGINS.
      if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, frameOrigin);
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
    if (isTrustedMessage(event, ORIGINS, source, CLOSE)) {
      close();
      return;
    }
    if (isTrustedMessage(event, ORIGINS, source, NEED_ARTIFACT)) {
      // Only the artifact this overlay was opened for: the page fetches it with its own access.
      if (state.src && event.data.src === state.src) answerArtifact(state.src, event.origin);
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

    // Focus sentinels keep Tab inside the dialog: past the iframe -> Close, before Close -> iframe.
    var startSentinel = sentinel(function () {
      iframe.focus();
    });
    var endSentinel = sentinel(function () {
      closeButton.focus();
    });

    dialog.appendChild(startSentinel);
    dialog.appendChild(bar);
    dialog.appendChild(iframe);
    dialog.appendChild(endSentinel);
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
      inerted: makeBackgroundInert(host),
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
    restoreBackground(current.inerted); // before restoring focus: the button sits in that background
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
