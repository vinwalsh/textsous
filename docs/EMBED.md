# Cook Along button for recipe sites

Add a "Cook along with TextSous" button to your recipe pages. A reader taps
it and gets a Cook Along for that recipe: mise en place first, a timeline
with one lane per component, and a timer on every step. It opens in an
overlay on top of your page, so the reader never leaves your site.

See it working on the demo post: https://open.textsous.com/embed-demo

## Quick start

Paste this where the button should appear:

```html
<script src="https://open.textsous.com/embed.js" async></script>
<div data-textsous-cook-along></div>
```

The `<div>` is optional. Without it, the button goes right after the
`<script>` tag (unless the tag sits in `<head>`, where nothing can show).
The button converts your page's `<link rel="canonical">` address, or the
page's own address without its `#fragment` when there is no canonical link.

Including the script more than once is safe: the second copy only picks up
placements the first one has not seen yet. You can use several placements
on one page, for example one per recipe card, each with its own
`data-recipe-url`.

## Attributes

Set these on a placement `<div>`, or on the `<script>` tag to apply them to
every placement on the page (a placement's own attribute wins).

| Attribute | Default | What it does |
|---|---|---|
| `data-recipe-url` | canonical link, else this page | The recipe page to convert. Relative URLs resolve against the page. |
| `data-src` | none | A pre-converted Cook Along artifact JSON URL (see below). Shown instead of converting. |
| `data-label` | `Cook along with TextSous` | The button text. |
| `data-autoopen` | off | Open the overlay as soon as the page loads (demos and screenshots). |

Example with two recipes on one page:

```html
<script src="https://open.textsous.com/embed.js" async></script>

<div data-textsous-cook-along data-recipe-url="/recipes/porridge"></div>
...
<div data-textsous-cook-along
     data-recipe-url="https://example.com/recipes/corn-salad"
     data-label="Cook this salad along"></div>
```

There is also a small script API: `TextSousEmbed.open({ url })`,
`TextSousEmbed.open({ src })` and `TextSousEmbed.close()`.

## How the overlay keeps readers on your page

- The button and the overlay chrome live in a Shadow DOM, so your CSS cannot
  break them and theirs cannot leak into your page.
- A tap opens a full-screen backdrop with a dialog over your page (full
  screen on phones). The dialog holds an iframe to
  `https://open.textsous.com/embed?url=<recipe URL>&utm_source=<your host>&utm_medium=embed`.
- Close it with the Close button, the Esc key, a click on the backdrop, or
  the Close button inside the Cook Along. Focus moves into the dialog when
  it opens and returns to the button when it closes; the page behind it
  does not scroll while it is open.
- Inside the overlay, "Save to TextSous" and every other link open in a new
  tab. Your page stays where the reader left it.
- The iframe talks to your page with `postMessage`. embed.js acts on
  `{ type: "textsous:close" }` only when it comes from the overlay's own
  iframe and from the script's origin.

The script loads the overlay from its own origin, so a copy served from a
preview or local build (`http://localhost:3102/embed.js`) opens that build's
`/embed` page.

## Same-page rule

The overlay converts only a recipe that lives on the site embedding it. It
compares the recipe address with the embedding page (from
`location.ancestorOrigins`, else the referrer), ignoring `www.`; a
subdomain of the same site also counts (`recipes.example.com` on
`example.com`), sibling subdomains do not (`alice.github.io` and
`bob.github.io`). When the browser reports neither, it proceeds. On a
mismatch the reader sees a short explanation and a link to convert the
recipe on open.textsous.com in a new tab instead.

`data-src` artifacts are not converted, so the rule does not apply to them.

## Privacy

- embed.js sets no cookies, stores nothing and loads no trackers. It sends
  nothing until a reader taps the button.
- On a tap, the overlay receives the recipe address and your site's host
  name (as `utm_source`). Converted recipes are private to the reader:
  never listed, indexed or shared. TextSous keeps a cached copy of a
  conversion, keyed by the recipe address, so the next reader of the same
  recipe gets it fast.
- Every Cook Along credits your site and author and links back to the
  original page.

If your site sends a Content-Security-Policy, allow
`script-src https://open.textsous.com` and
`frame-src https://open.textsous.com`.

## Speed, caching and pre-converted recipes

A fresh conversion reads the recipe, plans the timeline and checks it
against the original; that takes about two minutes, sometimes more. After
that the conversion is cached, so later readers of the same recipe address
get it in a second or two. To make the first tap fast as well, warm the
cache by opening the overlay yourself once after publishing.

Conversions on open.textsous.com share a daily free limit. When it is used
up, the overlay says so. To skip live conversions entirely, pre-convert
your recipe with the TextSous CLI and host the result yourself:

```bash
git clone https://github.com/vinwalsh/textsous && cd textsous && npm install
# needs MODEL_API_KEY (Meta Model API) in your environment
npm run cli -- convert https://example.com/recipes/porridge --out porridge.cookalong.json
```

Upload `porridge.cookalong.json` to your site, then point the placement at
it:

```html
<div data-textsous-cook-along data-src="/recipes/porridge.cookalong.json"></div>
```

On a tap, embed.js opens `/embed?src=<that URL>`. The overlay asks your page
for the file, embed.js fetches it with your page's own access (so it needs
no CORS headers when it lives on your site) and hands it to the overlay,
which validates it against the Cook Along schema before showing it. If that
handoff fails, the overlay fetches the URL directly, which works when the
file is served with `Access-Control-Allow-Origin`. Re-run the CLI when you
edit the recipe; the button always shows the file you host.

## No-JavaScript fallback: a plain link

Readers without JavaScript (and feed readers) can use a plain link. Unlike
the button, it leaves your page and opens the converter on
open.textsous.com:

```html
<a href="https://textsous.com/open?url=YOUR_RECIPE_URL&utm_source=open-textsous&utm_medium=embed">Open with TextSous</a>
```

Replace `YOUR_RECIPE_URL` with the URL-encoded address of the recipe page,
for example `https%3A%2F%2Fexample.com%2Fsoup`. `textsous.com/open`
redirects to `https://open.textsous.com` with the query string kept, and
the converter starts from `?url=`.

Put the link inside the placement and it becomes the fallback: with
JavaScript on, the button replaces it; with JavaScript off, readers see the
link.

```html
<div data-textsous-cook-along>
  <a href="https://textsous.com/open?url=https%3A%2F%2Fexample.com%2Fsoup&utm_source=open-textsous&utm_medium=embed">Open with TextSous</a>
</div>
```

## For contributors

- `public/embed.js`: the host-page script (plain JS, no build step). Its
  helpers are unit-tested in `tests/embed-script.test.ts`.
- `src/app/embed/`: the `/embed` page; `src/lib/embed.ts`: its pure helpers.
- `next.config.ts`: `/embed` sends `Content-Security-Policy: frame-ancestors *`;
  every other route sends `frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`; `/embed.js` sends
  `Cache-Control: public, max-age=300, s-maxage=3600` and
  `Access-Control-Allow-Origin: *`.
- `src/app/embed-demo/`: the demo post, built from the original CC0 fixture
  `eval/fixtures/toasted-oat-porridge.html`.
  `/embed-demo?src=<this site's /api/artifact link>&autoopen=1` opens the
  overlay on a saved artifact.
