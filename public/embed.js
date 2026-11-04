/*! TextSous Cook Along button. MIT License, (c) 2026 SOUS AI LLC.
 * Docs: https://github.com/vinwalsh/textsous/blob/main/docs/EMBED.md
 *
 * <script src="https://open.textsous.com/embed.js" async></script>
 * <div data-textsous-cook-along></div>   (optional placement; repeatable)
 * <div data-textsous-adjust></div>       ("Adjust with SOUS" menu; repeatable)
 *
 * Attributes (on a placement or on the script tag; a placement's own attribute wins):
 *   data-recipe-url  recipe page to convert (default: <link rel="canonical">, else this page)
 *   data-src         a pre-converted artifact JSON URL (made with the TextSous CLI)
 *   data-label       button text (default "Cook along with TextSous" / "Adjust with SOUS")
 *   data-autoopen    open the overlay right away (Cook Along buttons)
 * On the script tag only:
 *   data-mode="adjust"  the default button (no placement on the page) is "Adjust with SOUS"
 *   data-floating       the default button sits fixed at the bottom right (the bookmarklet)
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
    // Included twice: reuse the first copy, pick up any new placements (and a data-floating
    // button the bookmarklet's copy asks for).
    if (d && typeof w.TextSousEmbed.scan === "function") w.TextSousEmbed.scan(thisScript);
    return;
  }

  var VERSION = 1;
  var DEFAULT_ORIGIN = "https://open.textsous.com";
  var DEFAULT_LABEL = "Cook along with TextSous";
  var CLOSE = "textsous:close";
  var NEED_ARTIFACT = "textsous:need-artifact";
  var ARTIFACT = "textsous:artifact";
  var MAX_ARTIFACT_BYTES = 1024 * 1024;
  var DEFAULT_ADJUST_LABEL = "Adjust with SOUS";
  // The same list, in the same order, as DIETARY_TARGETS in src/lib/schema/variant.ts (a test checks).
  var DIETS = ["dairy-free", "egg-free", "gluten-free", "nut-free", "soy-free", "vegetarian", "vegan"];
  var MENU_MIN_SERVINGS = 1;
  var MENU_MAX_SERVINGS = 36;
  var MENU_DEFAULT_SERVINGS = 4;
  var MAX_CUISINE_CHARS = 80;

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

  /**
   * <origin>/embed?url=...|src=...[&servings=18|&dietary=vegan|&cuisine=Italian]&utm_source=<host>&utm_medium=embed
   * The adjustment comes from adjustForChoice; without one the address is the Cook Along's.
   */
  function buildFrameUrl(origin, opts) {
    var params = new URLSearchParams();
    if (opts.src) params.set("src", opts.src);
    else if (opts.url) params.set("url", opts.url);
    var adjust = opts.adjust || {};
    if (adjust.servings) params.set("servings", String(adjust.servings));
    if (adjust.dietary) params.set("dietary", adjust.dietary);
    if (adjust.cuisine) params.set("cuisine", adjust.cuisine);
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

  /** data-mode on the script tag: "adjust" for the Adjust with SOUS button, else "cook-along". */
  function modeOf(value) {
    return typeof value === "string" && value.trim().toLowerCase() === "adjust" ? "adjust" : "cook-along";
  }

  /** The first whole number in a schema.org recipeYield ("12 muffins", 4, ["4", "4 servings"]), or null. */
  function yieldServings(value) {
    var list = Array.isArray(value) ? value : [value];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (typeof item === "number" && isFinite(item) && item >= 1) return Math.floor(item);
      if (typeof item === "string") {
        var match = item.match(/\d+/);
        if (match && parseInt(match[0], 10) >= 1) return parseInt(match[0], 10);
      }
    }
    return null;
  }

  function isRecipeType(type) {
    var types = Array.isArray(type) ? type : [type];
    for (var i = 0; i < types.length; i++) {
      if (typeof types[i] === "string" && /(^|[/:])Recipe$/.test(types[i])) return true;
    }
    return false;
  }

  /** recipeYield of the first schema.org Recipe in JSON-LD texts (top level, arrays, @graph, mainEntity). */
  function findRecipeYield(texts) {
    function walk(node, depth) {
      if (!node || typeof node !== "object" || depth > 5) return null;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
          var inList = walk(node[i], depth + 1);
          if (inList !== null) return inList;
        }
        return null;
      }
      if (isRecipeType(node["@type"]) && node.recipeYield !== undefined && node.recipeYield !== null) {
        return node.recipeYield;
      }
      var inGraph = walk(node["@graph"], depth + 1);
      return inGraph !== null ? inGraph : walk(node.mainEntity, depth + 1);
    }
    for (var t = 0; t < (texts || []).length; t++) {
      var data;
      try {
        data = JSON.parse(texts[t]);
      } catch {
        continue;
      }
      var found = walk(data, 0);
      if (found !== null) return found;
    }
    return null;
  }

  /** Where the servings stepper starts: the page recipe's yield (kept within 1-36), else 4. */
  function defaultServings(texts) {
    var n = yieldServings(findRecipeYield(texts));
    if (n === null) return MENU_DEFAULT_SERVINGS;
    return Math.min(MENU_MAX_SERVINGS, Math.max(MENU_MIN_SERVINGS, n));
  }

  /** The stepper's entry as a whole number of servings from 1 to 36, else null. */
  function parseServings(value) {
    var text = String(value === null || value === undefined ? "" : value).trim();
    if (!/^\d{1,2}$/.test(text)) return null;
    var n = parseInt(text, 10);
    return n >= MENU_MIN_SERVINGS && n <= MENU_MAX_SERVINGS ? n : null;
  }

  /** The "Make it more..." entry: control characters and runs of spaces tidied, 1-80 characters, else null. */
  function cleanCuisine(value) {
    var raw = String(value === null || value === undefined ? "" : value);
    var text = "";
    for (var i = 0; i < raw.length; i++) {
      var code = raw.charCodeAt(i);
      text += code < 32 || code === 127 ? " " : raw.charAt(i);
    }
    text = text.replace(/\s+/g, " ").trim();
    return text.length >= 1 && text.length <= MAX_CUISINE_CHARS ? text : null;
  }

  /**
   * What a menu choice adds to the overlay address: {servings}, {dietary}, {cuisine}, or {} for
   * the plain Cook Along. Null when the entry won't work (the menu then says why).
   */
  function adjustForChoice(kind, value) {
    if (kind === "cook-along") return {};
    if (kind === "servings") {
      var servings = parseServings(value);
      return servings === null ? null : { servings: servings };
    }
    if (kind === "dietary") return DIETS.indexOf(value) === -1 ? null : { dietary: value };
    if (kind === "cuisine") {
      var cuisine = cleanCuisine(value);
      return cuisine === null ? null : { cuisine: cuisine };
    }
    return null;
  }

  /** "gluten-free" -> "Gluten-free". */
  function dietLabel(diet) {
    return diet.charAt(0).toUpperCase() + diet.slice(1);
  }

  /**
   * How far (px) to move a menu from its button's left edge so it stays inside the viewport's
   * side gutters: negative near the right edge, 0 when it fits.
   */
  function menuShift(buttonLeft, menuWidth, viewportWidth, gutter) {
    var left = Math.max(gutter, Math.min(buttonLeft, viewportWidth - gutter - menuWidth));
    return Math.round(left - buttonLeft);
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
    diets: DIETS.slice(),
    modeOf: modeOf,
    yieldServings: yieldServings,
    findRecipeYield: findRecipeYield,
    defaultServings: defaultServings,
    parseServings: parseServings,
    cleanCuisine: cleanCuisine,
    adjustForChoice: adjustForChoice,
    dietLabel: dietLabel,
    menuShift: menuShift,
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

  function makeButton(el, extraCss) {
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
    style.textContent = BUTTON_CSS + (extraCss || "");
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

  // ---------- Adjust with SOUS: a button and a small menu under it ----------

  // Same colors as the Cook Along button; inputs get a darker border (--ts-muted #726A65) so
  // their edges read at 3:1. Chips use --ts-secondary #F1EBE4 behind --ts-ink text.
  var ADJUST_CSS =
    ":host{display:inline-block;position:relative}" +
    "button{all:initial;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;" +
    "justify-content:center;gap:.5em;min-height:44px;min-width:44px;padding:0 16px;border-radius:30px;" +
    "font:600 15px/1.2 " + FONT + ";color:#22201C;background:#F1EBE4;border:1px solid #E2DBD5}" +
    "button:hover{background:#E9E1D8}" +
    "button:focus-visible,input:focus-visible{outline:2px solid #D45A35;outline-offset:2px}" +
    ".trigger{padding:.7em 1.2em;border:0;background:#B74725;color:#fff;font-size:16px}" +
    ".trigger:hover,.go:hover{background:#9D3D20}" +
    ".trigger svg{width:1.1em;height:1.1em;flex:none}" +
    ".go{border:0;background:#B74725;color:#fff}" +
    ".menu{position:absolute;top:calc(100% + 8px);left:0;z-index:2147483000;box-sizing:border-box;" +
    "width:340px;max-width:calc(100vw - 32px);padding:14px 14px 12px;background:#FFFFFF;color:#22201C;" +
    "border:1px solid #E2DBD5;border-radius:10px;box-shadow:0 12px 32px rgba(34,32,28,.18);" +
    "font:400 15px/1.4 " + FONT + ";text-align:left}" +
    ".menu[hidden]{display:none}" +
    ".menu:focus{outline:none}" +
    ".menu:focus-visible{outline:2px solid #D45A35;outline-offset:2px}" +
    ".title{margin:0 0 4px;font-weight:700;font-size:16px}" +
    ".group{margin:0;padding:10px 0;border-top:1px solid #E2DBD5}" +
    ".title+.group{border-top:0}" +
    ".label{display:block;margin:0 0 6px;font-weight:600;font-size:14px}" +
    ".row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
    ".stepper{display:inline-flex;align-items:center;gap:6px}" +
    ".chips{display:flex;flex-wrap:wrap;gap:6px}" +
    "input{box-sizing:border-box;min-height:44px;margin:0;padding:8px 12px;border:1px solid #726A65;" +
    "border-radius:10px;background:#FFFFFF;color:#22201C;font:400 16px/1.2 " + FONT + "}" +
    "input::placeholder{color:#726A65;opacity:1}" +
    ".count{width:64px;text-align:center;font-weight:600;-moz-appearance:textfield;appearance:textfield}" +
    ".count::-webkit-inner-spin-button,.count::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}" +
    ".text{flex:1 1 140px;min-width:0}" +
    ".hint{margin:6px 0 0;font-size:14px;color:#8E2A1A}" +
    ".hint:empty{display:none}" +
    ".note{margin:6px 0 0;font-size:14px;color:#726A65}" +
    "@media (prefers-reduced-motion:no-preference){.menu:not([hidden]){animation:ts-in .12s ease-out}}" +
    "@keyframes ts-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}";

  // The bookmarklet's button: fixed at the bottom right of any page, its menu opening upward.
  var FLOATING_HOST_CSS =
    ":host{position:fixed!important;top:auto!important;left:auto!important;" +
    "right:16px!important;bottom:16px!important;" +
    "right:max(16px,env(safe-area-inset-right))!important;bottom:max(16px,env(safe-area-inset-bottom))!important;" +
    "z-index:2147483645!important;display:block!important;margin:0!important}";
  var FLOATING_COOK_CSS = FLOATING_HOST_CSS + "button{box-shadow:0 4px 16px rgba(34,32,28,.3)}";
  var FLOATING_ADJUST_CSS =
    FLOATING_HOST_CSS +
    ".trigger{box-shadow:0 4px 16px rgba(34,32,28,.3)}" +
    ".menu{top:auto;bottom:calc(100% + 8px);left:auto;right:0;overflow-y:auto;" +
    "max-height:calc(100vh - 96px);max-height:calc(100dvh - 96px)}";

  var ADJUST_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/>' +
    '<circle cx="10" cy="17" r="2"/></svg>';

  var openMenu = null; // the Adjust menu that is open: { host, close }

  /** One element with attributes ("text" sets its text) and children. */
  function h(tag, props, children) {
    var el = d.createElement(tag);
    for (var key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (key === "text") el.textContent = props[key];
      else el.setAttribute(key, props[key]);
    }
    for (var i = 0; children && i < children.length; i++) el.appendChild(children[i]);
    return el;
  }

  function jsonLdTexts() {
    var out = [];
    var nodes = d.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i].textContent || "");
    return out;
  }

  /** The button's text: its own data-label, else the script tag's when the tag is in adjust mode. */
  function adjustLabel(el, tag) {
    var own = ownAttr(el, "data-label");
    if (own) return own;
    var shared = tag || script;
    if (shared && shared !== el && modeOf(shared.getAttribute("data-mode")) === "adjust") {
      var label = shared.getAttribute("data-label");
      if (label) return label;
    }
    return DEFAULT_ADJUST_LABEL;
  }

  function makeAdjustButton(el, floating, tag) {
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
    var style = h("style", { text: ADJUST_CSS + (floating ? FLOATING_ADJUST_CSS : "") });
    var trigger = h("button", {
      type: "button",
      class: "trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": "ts-menu",
    });
    trigger.innerHTML = ADJUST_ICON;
    trigger.appendChild(d.createTextNode(adjustLabel(el, tag)));

    // a. Change servings: a 1-36 stepper.
    var count = h("input", {
      class: "count",
      id: "ts-servings",
      type: "number",
      inputmode: "numeric",
      min: String(MENU_MIN_SERVINGS),
      max: String(MENU_MAX_SERVINGS),
      step: "1",
      enterkeyhint: "go",
    });
    var fewer = h("button", { type: "button", "aria-label": "One fewer serving", text: "−" });
    var more = h("button", { type: "button", "aria-label": "One more serving", text: "+" });
    var showServings = h("button", { type: "button", class: "go", "aria-describedby": "ts-servings-label", text: "Show it" });
    var servingsHint = h("p", { class: "hint", "aria-live": "polite" });
    // b. Make it...: the seven diets.
    var chips = h("div", { class: "chips" });
    // c. Make it more...: free text, like "Italian".
    var cuisine = h("input", {
      class: "text",
      id: "ts-cuisine",
      type: "text",
      maxlength: String(MAX_CUISINE_CHARS),
      placeholder: "e.g. Italian",
      autocomplete: "off",
      enterkeyhint: "go",
    });
    var showCuisine = h("button", { type: "button", class: "go", "aria-describedby": "ts-cuisine-label", text: "Show it" });
    var cuisineHint = h("p", { class: "hint", "aria-live": "polite" });
    // d. The full Cook Along.
    var cookAlong = h("button", { type: "button", class: "go", text: "Cook along" });

    var menu = h("div", { class: "menu", id: "ts-menu", role: "dialog", "aria-labelledby": "ts-title", tabindex: "-1" }, [
      h("p", { class: "title", id: "ts-title", text: "What would you like?" }),
      h("div", { class: "group", role: "group", "aria-labelledby": "ts-servings-label" }, [
        h("label", { class: "label", id: "ts-servings-label", for: "ts-servings", text: "Change servings" }),
        h("div", { class: "row" }, [h("span", { class: "stepper" }, [fewer, count, more]), showServings]),
        servingsHint,
      ]),
      h("div", { class: "group", role: "group", "aria-labelledby": "ts-diet-label" }, [
        h("p", { class: "label", id: "ts-diet-label", text: "Make it…" }),
        chips,
      ]),
      h("div", { class: "group", role: "group", "aria-labelledby": "ts-cuisine-label" }, [
        h("label", { class: "label", id: "ts-cuisine-label", for: "ts-cuisine", text: "Make it more…" }),
        h("div", { class: "row" }, [cuisine, showCuisine]),
        cuisineHint,
      ]),
      h("div", { class: "group" }, [
        cookAlong,
        h("p", { class: "note", text: "The whole recipe: prep first, then a timer on every step." }),
      ]),
    ]);
    menu.hidden = true;

    var prefilled = false;

    /** Opens the overlay for a choice, or says what to fix. The page never navigates. */
    function choose(kind, value, hint, field) {
      var adjust = adjustForChoice(kind, value);
      if (!adjust) {
        if (hint) {
          hint.textContent =
            kind === "servings"
              ? "Choose " + MENU_MIN_SERVINGS + " to " + MENU_MAX_SERVINGS + " servings."
              : "Type a style first, like Italian.";
        }
        if (field) field.focus();
        return;
      }
      closeMenu(true); // focus back on the button first, so it stays there if nothing opens
      open(targetFor(el), trigger, adjust);
    }

    function stepBy(delta) {
      var now = parseServings(count.value);
      var start = now === null ? defaultServings(jsonLdTexts()) : now;
      count.value = String(Math.min(MENU_MAX_SERVINGS, Math.max(MENU_MIN_SERVINGS, start + delta)));
      servingsHint.textContent = "";
    }

    function onKey(event) {
      if (event.key === "Escape" || event.key === "Esc") closeMenu(true);
    }

    function onOutside(event) {
      var target = event.target; // clicks inside the shadow root arrive retargeted to the host
      if (target === host || (host.contains && host.contains(target))) return;
      closeMenu(false);
    }

    function place() {
      if (floating) return; // anchored to the bottom right; the CSS keeps it inside the viewport
      menu.style.left = "0px";
      var viewport = d.documentElement.clientWidth || w.innerWidth;
      var shift = menuShift(host.getBoundingClientRect().left, menu.getBoundingClientRect().width, viewport, 16);
      menu.style.left = shift + "px";
    }

    function showMenu() {
      if (openMenu) openMenu.close(false);
      if (!prefilled) {
        count.value = String(defaultServings(jsonLdTexts()));
        prefilled = true;
      }
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      place();
      openMenu = { host: host, close: closeMenu };
      d.addEventListener("keydown", onKey, true);
      d.addEventListener("click", onOutside, true);
      menu.focus();
    }

    function closeMenu(returnFocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (openMenu && openMenu.host === host) openMenu = null;
      d.removeEventListener("keydown", onKey, true);
      d.removeEventListener("click", onOutside, true);
      if (returnFocus) trigger.focus();
    }

    for (var i = 0; i < DIETS.length; i++) {
      (function (diet) {
        var chip = h("button", { type: "button", text: dietLabel(diet) });
        chip.addEventListener("click", function () {
          choose("dietary", diet, null, null);
        });
        chips.appendChild(chip);
      })(DIETS[i]);
    }

    trigger.addEventListener("click", function () {
      if (menu.hidden) showMenu();
      else closeMenu(true);
    });
    fewer.addEventListener("click", function () {
      stepBy(-1);
    });
    more.addEventListener("click", function () {
      stepBy(1);
    });
    showServings.addEventListener("click", function () {
      choose("servings", count.value, servingsHint, count);
    });
    showCuisine.addEventListener("click", function () {
      choose("cuisine", cuisine.value, cuisineHint, cuisine);
    });
    cookAlong.addEventListener("click", function () {
      choose("cook-along", null, null, null);
    });
    // Enter in a field means "Show it". There is no <form>, so nothing can submit the host page.
    count.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      choose("servings", count.value, servingsHint, count);
    });
    cuisine.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      choose("cuisine", cuisine.value, cuisineHint, cuisine);
    });
    count.addEventListener("input", function () {
      servingsHint.textContent = "";
    });
    cuisine.addEventListener("input", function () {
      cuisineHint.textContent = "";
    });
    // Tabbing out of the menu closes it (focus moving within it, or a tap that moves no focus, does not).
    root.addEventListener("focusout", function (event) {
      var next = event.relatedTarget;
      if (!menu.hidden && next && next !== host && !(root.contains && root.contains(next))) closeMenu(false);
    });

    root.appendChild(style);
    root.appendChild(trigger);
    root.appendChild(menu);
    return host;
  }

  /** The bookmarklet's button: one fixed button at the bottom right when the page has no placement. */
  function addFloating(tag) {
    if (!d.body || tag.hasAttribute(READY)) return;
    if (d.querySelector("[data-textsous-floating],[data-textsous-script-button]")) return;
    tag.setAttribute(READY, "");
    var host = d.createElement("div");
    host.setAttribute("data-textsous-floating", "");
    d.body.appendChild(host);
    if (modeOf(tag.getAttribute("data-mode")) === "adjust") makeAdjustButton(host, true, tag);
    else makeButton(host, FLOATING_COOK_CSS);
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

  function open(target, returnFocus, adjust) {
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
    // Lets the overlay keep a phone's screen on during a 3-4 minute conversion.
    iframe.setAttribute("allow", "screen-wake-lock");
    iframe.src = buildFrameUrl(ORIGIN, {
      url: target.url,
      src: target.src,
      host: w.location.hostname,
      adjust: adjust,
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

  function scan(extraScript) {
    var placements = d.querySelectorAll("[data-textsous-cook-along]");
    var adjusters = d.querySelectorAll("[data-textsous-adjust]");
    var autoTarget = null;
    for (var j = 0; j < adjusters.length; j++) {
      if (adjusters[j].hasAttribute(READY)) continue;
      adjusters[j].setAttribute(READY, "");
      makeAdjustButton(adjusters[j], false, null);
    }
    // A second copy's script tag (the bookmarklet's), or this copy's own.
    var tag = extraScript && extraScript.nodeType === 1 && extraScript !== script ? extraScript : script;
    if (placements.length > 0) {
      for (var i = 0; i < placements.length; i++) {
        var el = placements[i];
        if (el.hasAttribute(READY)) continue;
        el.setAttribute(READY, "");
        makeButton(el);
        if (!autoTarget && isOn(attr(el, "data-autoopen"))) autoTarget = targetFor(el);
      }
    } else if (adjusters.length > 0) {
      // Adjust placements only: they are the page's buttons, so no default button.
    } else if (tag && isOn(tag.getAttribute("data-floating"))) {
      addFloating(tag);
    } else if (script && !script.hasAttribute(READY) && !d.querySelector("[data-textsous-script-button]")) {
      script.setAttribute(READY, "");
      var span = d.createElement("span");
      span.setAttribute("data-textsous-script-button", "");
      if (script.parentNode) script.parentNode.insertBefore(span, script.nextSibling);
      if (span.parentNode && span.parentNode !== d.head && modeOf(script.getAttribute("data-mode")) === "adjust") {
        makeAdjustButton(span, false, script);
      } else if (span.parentNode && span.parentNode !== d.head) {
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

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", function () {
      scan();
    });
  } else scan();
})();
