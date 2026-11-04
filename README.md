# TextSous Open

Open-source tools that convert any recipe — a URL, pasted text, or up to 3
cookbook photos of one recipe — into the TextSous Cook Along format: a
canonical recipe JSON, a component-lane cooking timeline, and adjustable
variants (servings, dietary, cuisine, SOUS voice). The web app runs at
https://open.textsous.com and hands finished recipes to https://textsous.com.

## 60-second quickstart

Prerequisites: Node 22+ and a Meta model API key.

```sh
git clone https://github.com/vinwalsh/textsous.git
cd textsous
npm ci
export MODEL_API_KEY=your-key-here
npx tsx src/cli.ts convert eval/fixtures/herby-white-bean-toast.txt --out /tmp/herby.json
```

That converts one of the bundled sample recipes (about three minutes of model
time) and writes the Cook Along artifact to `/tmp/herby.json`. Add
`--timeline` to print the cooking timeline, or `--servings 4 --dietary vegan`
to adjust it. `npx tsx src/cli.ts convert --help` lists every flag.

Prefer the browser? `npm run dev`, open http://localhost:3000, and paste a
recipe URL — the same pipeline runs behind `/api/convert`. Send it
`Accept: application/x-ndjson` to get the conversion progressively, one
event per line as each part is ready (`src/lib/convert-events.ts`).

## Provider setup

Model access goes through one client with config from the environment:

| Variable         | Default                    | Purpose                        |
| ---------------- | -------------------------- | ------------------------------ |
| `MODEL_API_KEY`  | (required)                 | Meta model API key             |
| `MODEL_BASE_URL` | `https://api.meta.ai/v1`   | Meta API endpoint              |
| `MODEL_ID`       | `muse-spark-1.3`           | Model to convert with          |
| `BASETEN_API_KEY`| falls back to `MODEL_API_KEY` | Optional Baseten fallback key |
| `BASETEN_BASE_URL` | falls back to `MODEL_BASE_URL` | Optional Baseten endpoint  |
| `REASONING_EFFORT_<STAGE>` | `low` (`minimal` for overview, procedure and scaling) | reasoning_effort for one stage, e.g. `REASONING_EFFORT_PROCEDURE=minimal` |

The Baseten profile always uses `meta-models/muse-spark-open-1026`. Never
commit keys: copy them into `.env.local`, which is git-ignored.

Contributor-tier model IDs (ending in `-contributor`) let Meta train on
prompts and outputs. They may only run locally on the bundled fixtures, and
production refuses them outright.

## The format

[`docs/FORMAT.md`](docs/FORMAT.md) is the human-readable spec, generated from
the zod sources so every field has a line. The normative JSON Schemas live in
[`docs/schema/`](docs/schema/) — textsous.com validates imports against those
files. Regenerate both after any schema change:

```sh
npm run schema   # docs/schema/*.json
npm run docs     # docs/FORMAT.md
```

CI fails when the committed copies differ from a fresh run.

## Cook Along button for recipe sites

Recipe sites can add a "Cook along with TextSous" button. A tap opens the
Cook Along in an overlay on the same page, so readers never leave the site:

```html
<script src="https://open.textsous.com/embed.js" async></script>
<div data-textsous-cook-along></div>
```

The button converts the page's canonical address (or `data-recipe-url`), only
for recipes on the site that embeds it, or shows a Cook Along you converted
ahead of time with the CLI (`data-src`). Try it on
https://open.textsous.com/embed-demo. [`docs/EMBED.md`](docs/EMBED.md) covers
the attributes, privacy, caching, and a plain "Open with TextSous" link for
readers without JavaScript.

## Use TextSous from your AI assistant

Connect Muse, ChatGPT, Claude or Gemini to the TextSous MCP server at
`https://textsous.com/api/mcp` and sign in with a free TextSous account (steps
at https://open.textsous.com/assistants). Then send your assistant a recipe
link, pasted text or a photo and ask for a cook along. The assistant writes
the Cook Along with its own model, so it is not limited by this site's daily
free conversions; TextSous checks it, schedules it, and gives you a link that
opens on open.textsous.com plus a copy in your TextSous Cookbook. When the
site's free conversions run out, its error message links to those steps.

The MCP tools call this repo's skills API ([`docs/SKILLS.md`](docs/SKILLS.md)):
a public format guide for assistants, plus two secret routes that fetch a
recipe page and that validate, schedule and store an assistant's cook along.
No skills route calls a model.

## Self-hosting

Beyond the provider variables above, the web app reads:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ARTIFACT_SIGNING_SECRET` | (unset) | Signs saved artifact links ("Save to TextSous", skills API) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | local files and memory | Cache, limits and saved artifacts in Redis |
| `DAILY_CONVERSION_CAP` | `300` | Live conversions per UTC day; `0` pauses them |
| `RATE_LIMIT_PER_HOUR` | `20` | Live requests per IP per hour, for each of convert, adjust and photo |
| `SKILLS_API_SECRET` | (unset) | Turns on the two secret skills routes |
| `PUBLIC_ORIGIN` | see `docs/SKILLS.md` | Origin used in skills API links |
| `NEXT_PUBLIC_SAVE_TO_TEXTSOUS` | on | `off` at build time hides "Save to TextSous" |

The skills API needs no model key. `GET /api/skills/format` is always public;
`POST /api/skills/source` and `POST /api/skills/cook-along` answer 503 until
`SKILLS_API_SECRET` is set, then expect it as `Authorization: Bearer <secret>`.
Give the same value to your own MCP server or agent, and never send it from a
browser.

## Limits

- Recipe URLs must be public `https` pages; private addresses, credentials,
  and non-HTML content are refused.
- One recipe per page: roundups and collections are rejected, not guessed at.
- Pasted text can be up to 60,000 characters.
- Up to 3 photos of one recipe, for a recipe that runs over more than one
  page: PNG, JPEG, or WebP, in page order. The browser shrinks each photo
  before upload (at most 1600 px, JPEG); the server takes up to 4 MB a photo
  and 4.4 MB in all, reads every page in one model call, and processes the
  photos in memory only.
- A fresh conversion takes about a minute; the page fills in as each part is
  ready (the recipe's facts and a short summary first, then ingredients,
  prep and steps), and a recipe converted before opens from the cache right
  away.
- Servings rescale from 0.5 to 36. Adjustments never change a step's timing;
  removing an ingredient can drop a step that only handled it.
- Live conversions are limited per IP to 20 an hour each for converting,
  adjusting and photos (`RATE_LIMIT_PER_HOUR`), and all of them share a daily
  global cap (`DAILY_CONVERSION_CAP`, default 300). Cache hits are free.
- Saved artifacts live 24 hours under unguessable signed URLs.
- Allergen lists ("Contains", "May contain") can miss things: always check
  the labels.
- No nutrition or health claims anywhere: the converter structures recipes, it
  does not advise on them.

## Credit and takedown

Every converted recipe credits its source: site name, author, and a "View
original" link for URLs; book title, author, and page for photos. Converted
recipes are private to the person who requested them — never listed, indexed,
or shared. Source images are never copied.

To request a takedown, write to privacy@textsous.com.

## Developing

```sh
npm test          # offline suite (no key needed)
npm run typecheck
npm run lint
npm run smoke     # one tiny live model call per provider
npm run warm -- --base https://your-deployment   # convert the /demo recipes once (live, uses daily units)
```

`AGENTS.md` holds the full contributor rules; `TASKS.md` tracks the build;
`HANDOFF.md` sums up the current state and the TextSous app contract.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 SOUS AI LLC.
