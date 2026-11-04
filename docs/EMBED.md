# Cook Along button for recipe sites

Add a **Build “Cook Along” with TextSous** button to your recipe pages. A reader taps
it and gets a Cook Along for that recipe: mise en place first, a timeline
with one lane per component, and a timer on every step. It opens in an
overlay on top of your page, so the reader never leaves your site.

See it working on the demo post: https://open.textsous.com/embed-demo, and
on four pretend recipe blogs: https://open.textsous.com/demo-sites

A second button, "Adjust with SOUS", lets the reader choose first: change
the servings, make it dairy-free or vegan, make it more Italian, or open
the plain Cook Along. See [Adjust with SOUS](#adjust-with-sous) below.

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
every placement on the page. A placement's own attribute wins: a placement
uses its own `data-src`, then its own `data-recipe-url`, and only then the
script tag's `data-src` or `data-recipe-url`.

| Attribute | Default | What it does |
|---|---|---|
| `data-recipe-url` | canonical link, else this page | The recipe page to convert. Relative URLs resolve against the page. |
| `data-src` | none | A pre-converted Cook Along artifact JSON URL (see below). Shown instead of converting. |
| `data-label` | `Build “Cook Along” with TextSous` | The button text. |
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

## Adjust with SOUS

Paste this where the button should appear:

```html
<script src="https://open.textsous.com/embed.js" async></script>
<div data-textsous-adjust></div>
```

A tap opens a small menu under the button, titled "What would you like?":

- **Change servings**: a stepper from 1 to 36 and "Show it". It starts at
  the first whole number of your page's schema.org Recipe `recipeYield`
  (JSON-LD at the top level, in a list, in `@graph` or as `mainEntity`),
  kept within 1-36, or at 4 when the page has none.
- **Make it…**: Dairy-free, Egg-free, Gluten-free, Nut-free, Soy-free,
  Vegetarian or Vegan, one button each.
- **Make it more…**: free text up to 80 characters ("Italian", "Thai
  street food") and "Show it".
- **Build “Cook Along”**: the plain Cook Along, the same as the Cook Along button.

Each choice opens the same overlay as the Cook Along button (focus inside,
Esc and Close, focus back to the button afterwards), and the choice is
applied as soon as the cook along is ready. The menu works by keyboard
(Enter in a field means "Show it") and closes on Esc (focus returns to the
button), on a click outside it, or when focus moves out of it. Only one
menu is open at a time. Nothing in it is a form or a link, so it never
submits or navigates your page. On a narrow screen it moves left to stay
inside the window.

`data-textsous-adjust` placements are repeatable and take the same
`data-recipe-url`, `data-src` and `data-label` attributes as Cook Along
placements. `data-label` defaults to "Adjust with SOUS"; the script tag's
`data-label` applies to Adjust buttons only when the tag also has
`data-mode="adjust"`. `data-autoopen` applies to Cook Along buttons only.
Both kinds of placement can share a page.

On the script tag only:

| Attribute | What it does |
|---|---|
| `data-mode="adjust"` | With no placement on the page, the default button (right after the script tag) is "Adjust with SOUS" instead of "Build “Cook Along” with TextSous". |
| `data-floating` | With no placement on the page, the default button is fixed at the bottom right of the window instead, and its menu opens upward. The bookmarklet uses this. |

A page with any `data-textsous-adjust` placement gets no default button.

### What the overlay receives

`/embed` takes three optional parameters next to `url` or `src`:

| Parameter | Accepted values |
|---|---|
| `servings` | A number from 0.5 to 36 (the adjust range). The menu sends whole numbers from 1 to 36. |
| `dietary` | `dairy-free`, `egg-free`, `gluten-free`, `nut-free`, `soy-free`, `vegetarian` or `vegan` (any letter case). |
| `cuisine` | 1 to 80 characters once trimmed; control characters and runs of spaces become one space. |

A value that doesn't fit is ignored, never an error, and the rest still
applies. A menu choice opens, for example,
`/embed?url=<recipe>&servings=18&utm_source=<your host>&utm_medium=embed`.

While it works, the overlay shows one line at the top: "Scaling to 18
servings…", "Making it vegan…" or "Making it more Italian…", until the
adjusted cook along shows (or the adjustment fails, which the adjust panel
explains). The adjustment takes the same path as changes a reader queues
while a cook along is being written: one `/api/adjust` call as soon as the
cook along is ready, on a cache hit too. The adjust panel then shows what
changed and offers "Back to the original". If the reader changes the queued
choices in the panel while the recipe converts, theirs replace the menu's.

## Bookmarklet: try it on any recipe page

The /embed-demo post has a "Try it on any recipe page" link. Drag it to
your bookmarks bar, then click the bookmark on any recipe page. It adds
`embed.js` from the demo page's own origin (https://open.textsous.com on
production) with `data-floating` and `data-mode="adjust"`, so one Adjust
with SOUS button appears at the bottom right of that page. It runs only in
your own browser and changes nothing on the site; clicking it again on the
same page adds nothing more. On a page that already has TextSous
placements, it adds nothing either.

The overlay converts the page's own recipe (its canonical link, else its
address), so the same-page rule holds. Some sites block outside scripts
with a Content-Security-Policy; on those, the button doesn't appear.

## How the overlay keeps readers on your page

- The button and the overlay chrome live in a Shadow DOM, so your CSS cannot
  break them and theirs cannot leak into your page.
- A tap opens a full-screen backdrop with a dialog over your page (full
  screen on phones). The dialog holds an iframe to
  `https://open.textsous.com/embed?url=<recipe URL>&utm_source=<your host>&utm_medium=embed`.
- Close it with the Close button, the Esc key, a click on the backdrop, or
  the Close button inside the Cook Along. Focus moves into the dialog when
  it opens, Tab stays inside it, and focus returns to the button when it
  closes. While it is open, the rest of your page is made `inert` (screen
  readers and the keyboard skip it) and does not scroll.
- Closing the overlay ends the reader's wait, not the conversion: the
  server finishes it and caches it, and reopening after that opens it right
  away. Reopening while it is still running starts a second conversion.
- Inside the overlay, "Save to TextSous" and every other link open in a new
  tab. Your page stays where the reader left it.
- The iframe talks to your page with `postMessage`. embed.js acts on
  `{ type: "textsous:close" }` only when it comes from the overlay's own
  iframe and from the script's origin. If you load the script over `http:`,
  embed.js also accepts the `https:` version of that origin, because the
  host redirects the overlay to https.

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
  nothing until a reader taps the button. Opening the Adjust with SOUS menu
  sends nothing either (the servings start from your page's own JSON-LD);
  only a choice in it opens the overlay.
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
against the original; that takes about a minute, and the overlay fills in
as each part is ready. After that the conversion
is cached, so later readers of the same recipe address get it in a second or
two. To make the first tap fast as well, warm the cache by opening the
overlay yourself once after publishing. (For open.textsous.com's own
`/embed-demo` post, `npm run warm -- --base https://open.textsous.com` does
this along with the /demo recipes.)

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
  helpers are unit-tested in `tests/embed-script.test.ts`: URL and target
  resolution, the overlay address with an adjustment, recipeYield parsing,
  menu input checks and placement, and its diet list against
  `DIETARY_TARGETS`.
- `src/app/embed/`: the `/embed` page; `src/lib/embed.ts`: its pure helpers
  (`parseEmbedRequest` reads `servings`, `dietary` and `cuisine`;
  `adjustLine` writes the calm line; `buildEmbedUrl` mirrors embed.js's
  `buildFrameUrl`).
- `next.config.ts`: `/embed` sends `Content-Security-Policy: frame-ancestors *`;
  every other route sends `frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`; `/embed.js` sends
  `Cache-Control: public, max-age=300, s-maxage=3600` and
  `Access-Control-Allow-Origin: *`.
- `/api/convert`, `/api/adjust`, `/api/photo` and `/api/artifact` refuse a
  POST that the browser marks `Sec-Fetch-Site: cross-site` (403), so another
  site cannot call them directly from its readers' browsers (a hidden form
  or a no-cors fetch). The overlay's own requests come from the `/embed`
  page and are same-origin, so a page that frames `/embed` can still start
  conversions of recipes on its own site; the per-IP hourly limit and the
  daily cap bound that. Scripts and servers send no such header and are not
  affected.
- "Save to TextSous" opens textsous.com/import. A deploy built with
  `NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off` hides the button (on the site and in the
  overlay) until that page is live.
- `src/app/embed-demo/`: the demo post, built from the original CC0 fixture
  `eval/fixtures/toasted-oat-porridge.html`. `Bookmarklet.tsx` is its "Try
  it on any recipe page" section; React refuses `javascript:` addresses, so
  the link gets its `href` after it mounts.
  `/embed-demo?src=<this site's /api/artifact link>&autoopen=1` opens the
  overlay on a saved artifact.
- Testing the demo: plain `/embed-demo` (no `?src=`) converts the demo
  page's own address, so it only converts on https://open.textsous.com. On
  localhost the address is http (refused by intake), and on a Vercel
  preview the server's fetch of its own protected preview URL gets a 401.
  On a preview or local build, test with
  `/embed-demo?src=<saved artifact link>&autoopen=1`.
