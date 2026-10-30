# TextSous Open

Open-source tools that convert any recipe — a URL, pasted text, or a cookbook
photo — into the TextSous Cook Along format: a canonical recipe JSON, a
component-lane cooking timeline, and adjustable variants (servings, dietary,
cuisine, SOUS voice). The web app runs at https://open.textsous.com and hands
finished recipes to https://textsous.com.

## 60-second quickstart

Prerequisites: Node 22+ and a Meta model API key.

```sh
git clone https://github.com/vinwalsh/textsous.git
cd textsous
npm ci
export MODEL_API_KEY=your-key-here
npx tsx src/cli.ts convert eval/fixtures/herby-white-bean-toast.txt --out /tmp/herby.json
```

That converts one of the bundled sample recipes (about two minutes of model
time) and writes the Cook Along artifact to `/tmp/herby.json`. Add
`--timeline` to print the cooking timeline, or `--servings 4 --dietary vegan`
to adjust it. `npx tsx src/cli.ts convert --help` lists every flag.

Prefer the browser? `npm run dev`, open http://localhost:3000, and paste a
recipe URL — the same pipeline runs behind `/api/convert`.

## Provider setup

Model access goes through one client with config from the environment:

| Variable         | Default                    | Purpose                        |
| ---------------- | -------------------------- | ------------------------------ |
| `MODEL_API_KEY`  | (required)                 | Meta model API key             |
| `MODEL_BASE_URL` | `https://api.meta.ai/v1`   | Meta API endpoint              |
| `MODEL_ID`       | `muse-spark-1.3`           | Model to convert with          |
| `BASETEN_API_KEY`| falls back to `MODEL_API_KEY` | Optional Baseten fallback key |
| `BASETEN_BASE_URL` | falls back to `MODEL_BASE_URL` | Optional Baseten endpoint  |

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

## Embed on your site

Food bloggers can send readers to TextSous with one link per recipe page (see
[`docs/EMBED.md`](docs/EMBED.md)):

```html
<a href="https://textsous.com/open?url=YOUR_RECIPE_URL&utm_source=open-textsous&utm_medium=embed">Open with TextSous</a>
```

## Limits

- Recipe URLs must be public `https` pages; private addresses, credentials,
  and non-HTML content are refused.
- One recipe per page: roundups and collections are rejected, not guessed at.
- Photos must be PNG, JPEG, or WebP under 5 MB, processed in memory only.
- Servings rescale from 0.5× to 12; timers and the one-cook schedule never
  change under adjustments.
- Live conversions are rate-limited per IP with a daily global cap
  (`DAILY_CONVERSION_CAP`, default 100).
- Saved artifacts live 24 hours under unguessable signed URLs.
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
```

`AGENTS.md` holds the full contributor rules; `TASKS.md` tracks the build.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 SOUS AI LLC.
