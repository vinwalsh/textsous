# Handoff: TextSous Open converter

For the next agent picking up this repo, and for whoever works on the
TextSous app's side of the handoff. Last updated: 2026-11-04 (M10).

## Where things stand

- **M1–M10** are on main and deployed at https://open.textsous.com. M6.1,
  M6.3, M6.4 and M6.6 still wait for the owner's phone re-checks (TASKS.md
  O14).
- **M10** went live on Nov 4 evening (`8d80f33`): the TextSous Cook Along
  view is the finished page's body (ported from the TextSous app at the
  owner's direction; adapter in src/lib/cooking-pilot/from-artifact.ts; the
  open sections remain as the fallback), /cook-along-demo, per-section
  progress states and the sticky cooking line, "Before your changes" and
  Adjusting marks, and /glasses for Meta Ray-Ban Display.
- **M9** went live on Nov 4 afternoon (`7b9f56c`): Adjust with SOUS in
  embed.js and /embed, the /demo-sites blogs, the bookmarklet, 12-hour
  tasks and id repair before scheduling.
- **M8** went live on Nov 4 (`cf3fc28` at 15:05 ET, review fixes and
  free-text rescaling in `9dfae4e` at 15:55 ET): progressive conversion,
  per-stage reasoning effort, up to 3 photos, servings up to 36. A fresh
  conversion now finishes in about 45-80 s, with the recipe's facts on screen
  in a few seconds.
- **M7** (TASKS.md M7.1–M7.9) went live on Nov 4 at 04:17 ET: main
  fast-forwarded from `3e56ebb` to `f92e0a1`, 93 commits, docs included.
  The production checks passed and the demo cache is warm (O12). M7.10 stays
  open for the owner's Muse and phone checks (O13, O14).
- Gates on main: 1102/1102 offline in 90 files with `MODEL_API_KEY` unset,
  typecheck, lint, build, and `npm run schema && npm run docs` with no diff;
  CI green.
- Other open items: M5.3 (owner review of the NEW-WORK.md summary), M5.5
  (final state), and owner actions O3, O4, O8, O9, O13 and O14 (O6, O7,
  O10, O11 and O12 are done). Submission is due Nov 4, 9:00 PM ET.
- The TextSous app's side (private repo) is merged and deployed: Cookbook
  import (/open, /import), the MCP recipe tools, and the 12-hour task cap.
- Sources of truth: TASKS.md (status), NEW-WORK.md (dated log), AGENTS.md
  (rules), README.md (users), docs/SKILLS.md and docs/EMBED.md
  (integrators), docs/FORMAT.md and docs/schema/ (the format).

## Hand-off to the TextSous app

textsous.com lives in a private repo, and this repo never depends on its
code. These are the contracts between the two, as of M7.

### Links into this app
- `https://textsous.com/open?url=<recipe page URL>` (or
  `?src=<artifact JSON URL>`) redirects to
  `https://open.textsous.com/?<same query>`. The home route converts `url`
  (cache first) or loads `src`; extra parameters such as `utm_*` ride along.
  Bare `/open` is 404 there.

### Save to TextSous: the import link
- The viewer stores the artifact for 24 hours (`POST /api/artifact`), then
  opens `https://textsous.com/import?src=<encodeURIComponent(signed artifact URL)>`.
  Inside the embed overlay it opens in a new tab.
- The signed artifact URL has exactly this shape, with nothing else in the
  query:
  `https://open.textsous.com/api/artifact/<lowercase uuid>?sig=<64 lowercase hex>`.
  `sig` is an HMAC-SHA256 over `<id>.<expiresAt>` with
  ARTIFACT_SIGNING_SECRET; the TextSous app holds no copy and needs none.
- `GET` on it returns the artifact JSON, server to server (no CORS), as
  many times as needed for 24 hours, because sign-in can interrupt the
  first try. A bad signature gets 403; an expired or missing artifact 404.
- The TextSous app accepts only that shape, from origins on its allowlist
  (https://open.textsous.com by default). A link made on a preview carries
  the preview's origin, so add the preview to that allowlist before testing
  imports from it.
- A build with `NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off` hides the button while
  textsous.com/import is not live.

### Skills API (docs/SKILLS.md)
The TextSous MCP server (https://textsous.com/api/mcp, OAuth sign-in) calls
these routes server to server:

| Route | Auth | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/skills/format` | public, cached 5 min | `{ skillsVersion: 1, formatVersion: 1, instructions, inputSchema, example }` | none |
| `POST /api/skills/source` with `{ url }` | secret | `{ ok: true, source: { url, site, author, title, jsonLd, text } }` | 422 `refused_url`, `multiple_recipes`, `fetch_failed` or `not_a_recipe` |
| `POST /api/skills/cook-along` with the lenient body | secret | `{ ok: true, artifactId, artifactUrl, viewUrl, expiresAt, summary, warnings }` | 422 `{ ok: false, errors: [{ path, code, message }], warnings }`, at most 50 errors |

- Secret: `Authorization: Bearer <secret>`, compared in constant time.
  SKILLS_API_SECRET here and TEXTSOUS_OPEN_SKILLS_SECRET on the TextSous app
  hold the same value. Shared failures: 503 `not_configured` (the secret is
  unset here), 401 `unauthorized`, 413 `too_large` (over 256 KB), 400
  `invalid_json`, and 429 `rate_limited` with `error.scope`: `"account"`
  (60 an hour per `X-TextSous-Account`, an opaque per-person hash the caller
  sends) or `"service"` (600 an hour per secret). The TextSous app can read
  `error.scope` instead of matching the message wording.
- `artifactUrl` has the import shape above, built on `PUBLIC_ORIGIN`, else
  https://open.textsous.com on Vercel production, else the request's own
  origin. `viewUrl` is `<origin>/?src=<encodeURIComponent(artifactUrl)>`.
  Both work until `expiresAt` (an ISO time, 24 hours out).
- `summary`: `title`, `servings`, `totalMinutes` and `handsOnMinutes` (from
  the code schedule, never from the assistant), `taskCount`, and
  `allergens` and `traces` (EU-14, after the allergen floor).
- The server fills ids and defaults, validates with the real zod schemas,
  schedules, runs the coded checks and compiles. The seven model judgments
  are recorded as not run, because the person's own assistant wrote the
  recipe. No skills route calls a model or uses the daily cap.
- The TextSous side (built, not merged) adds three MCP tools:
  `get_cook_along_format` (read; caches the format for 10 minutes),
  `get_recipe_source` (read) and `save_cook_along` (write). The last one
  imports `artifactUrl` into the person's Cookbook and returns `viewUrl`,
  `cookbookUrl` (`https://textsous.com/dashboard/cookbook/<id>`),
  `summary`, `warnings` and `expiresAt`; 422 errors come back as data for
  the assistant to fix and resend. Its input is never stricter than this
  API's, and its per-person limits (30 saves and 30 link reads an hour) fit
  inside the 60-an-hour account limit.

### Format
- `formatVersion` stays 1. M7 added optional fields only:
  `recipe.nativeServings`, task `why`, and the artifact's `reviewNotes`. The
  published docs/schema/*.json leave optional fields out of `required`.
- The TextSous importer strips unknown keys and checks the version exactly,
  so M7 artifacts import today. When it next refreshes its copy of
  docs/schema/artifact.json, it should learn the three fields (or keep
  stripping them).

### Owner steps across both sides
TASKS.md O10 (one secret on both projects), O11 (the Cookbook import PR
after its database migration, then the MCP recipe-tools change, deployed)
and O13 (Muse end to end). The M7 deploy and O12 (warm the demo cache) are
done.

## Open loops

- Work through the remaining owner actions (TASKS.md).
- textsous.com/open and /import return 404 until O11 ships. That affects
  "Save to TextSous" and the plain "Open with TextSous" link in README.md
  and docs/EMBED.md. M7 deployed with the button shown; if O11 slips, build
  with `NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off` to hide it.
- Deferred, owner's call:
  - /embed starts an uncached conversion inside the frame without a tap,
    so an embedding page can start conversions on its visitors'
    connections, bounded by the per-IP hourly limit and the daily cap. A
    "Start" tap for uncached URLs (which needs a cache-only probe on
    /api/convert) would close that, but it changes the embed's auto-convert
    behavior, so it waits.
  - Closing the overlay ends the reader's wait, not the server's work: a
    URL conversion still finishes and is cached. Reopening (or converting
    the same link again) before then starts a second live conversion, with
    another daily unit and a fresh wait of about a minute. Sharing one
    in-flight conversion per URL would avoid that. EMBED.md documents the
    behavior.
  - The skills secret budget stays at 600 requests an hour: raising it
    would weaken the cap on a leaked secret or a looping caller.
  - The "Open" pill's text is 4.49:1 on its background, as the brand colors
    set it; it is part of the wordmark.
  - On the TextSous app: whether sign-ups that start from an assistant
    should skip its setup steps (two "Skip" taps today), as /import does.
- Not exercised yet: no real assistant has called the skills API end to
  end (needs O10, O11 and the deploy); the cross-origin `data-src` handoff
  has unit tests only; whether Vercel serves `/embed.js` with the
  Cache-Control from next.config.ts (check with `curl -I` after the deploy).
- Old cache entries keep their stored `schedule`. The oven heat-up change
  moved oven tasks earlier, and the viewer and the skills summary recompute
  the schedule, but an API client reading `schedule` from /api/convert can
  see the old minutes.
- Output gaps seen in the live preview: the stroganoff folds its last
  simmer into a hands-on task and puts the parsley prep in the base lane;
  the salmon whisks its glaze in the cook phase; the tacos have no
  unattended tortilla-warming interval. Code rewording after a swap can
  read awkwardly ("Brown coconut oil"); each case is listed in What changed,
  and amounts inside reworded text are not converted to the substitute's.
- M5.5 asks for health to report "the Standard tier", but `/api/health`
  has no tier field; `"contributorModel": false` on muse-spark-1.3 is the
  closest signal. Ask the owner.
- Pre-warm evidence from M5.2 lived in `/tmp/prewarm*.log` (scratch, never
  committed); `npm run warm` replaces that procedure.

## Environment notes

Muse Code sandbox (Oct 27 – Nov 3):
- External web fetching fails except for allowlisted hosts (the npm
  registry, the model API and open.textsous.com). URL eval runs, URL
  curation and localhost servers must run elsewhere. Production fetches
  fine.
- The `tsx` CLI fails there (EPERM on its IPC pipe); run scripts with
  `node --import tsx <script>`. Committed `npm run` scripts are unaffected.
- `npm ci` needs `--cache /tmp/npm-cache` (home dir unwritable).
- No port binding: verify UI through `renderToString` smokes and
  production, never a local server.
- `git push` auth fails there; the owner pushes. Commit only on explicit
  ask, and never push on your own.
- The local model key lives in `.env.local` (gitignored). Source it for live
  runs; never print, copy or commit it.

M7 machine (Nov 3–4):
- No model key on that machine: live checks ran on a Vercel preview.
- Headless Chrome lays pages out at least about 500 px wide, so 390 px
  screenshots need DevTools device emulation or a 390 px iframe.
- Disk is tight: run `rm -rf .next/cache` after every `next build`.
- `next dev` used to write a managed block into AGENTS.md; next.config.ts
  now sets `agentRules: false`. Prefer `next build` + `next start` for
  screenshots anyway.

## Key commands

```sh
npm test && npm run typecheck && npm run lint   # gates (offline)
npm run build                                    # prod build
npm run smoke                                    # one tiny live call per provider
npx tsx src/cli.ts convert <url|file> --out /tmp/x.json [--timeline]
  [--servings n] [--dietary target] [--cuisine name] [--voice sous]
npm run eval [--fixtures-only] [--limit N] [--out path]   # live $, see M5.1
npm run schema && npm run docs                   # regen docs (CI gates the diff)
npm run warm -- --base https://open.textsous.com # live $: warm /demo and /embed-demo after a deploy
curl -fsS https://open.textsous.com/api/health   # status, model, limits, which secrets are set
```

## Decisions worth knowing

- `GET /api/artifact/[id]`: 403 on tampered signature, 404 on expired or
  missing (ids are unguessable UUIDs, so the oracle risk is accepted).
- `ChatTextMessage` kept its name but is now a per-role union, so
  images-only-in-user-messages is compiler-checked.
- `/api/convert` accepts `{recipe}` for the photo-confirm flow; it skips
  canonicalize (empty stage report) so book credit survives.
- M8: `/api/convert` streams NDJSON progress events (facts, overview,
  recipe, procedure, then done or error) to clients that send
  `Accept: application/x-ndjson`; other clients, including the warm
  script, get the same JSON as before. Every model stage
  sends an explicit reasoning_effort (`src/lib/model/efforts.ts`; mostly
  `low`; overview, procedure and scaling `minimal`), tunable per stage with
  `REASONING_EFFORT_<STAGE>` in Vercel and, on previews only, per request
  with the `x-textsous-efforts` header. Efforts do not touch the cache key.
- All route logs go through a redacting logger (URLs + data URLs stripped
  by construction, not by discipline).
- Friendly errors carry an optional `paste-text` action for URL-attributable
  failures (refused address, roundup page, unreachable site).
- The fetcher keeps its honest `TextSousOpen` user-agent; never impersonate
  a browser to bypass publisher gates — gated pages fail gracefully and the
  UI offers pasting the text instead.
- Cache hits are served before any limit and cost nothing. A daily unit is
  reserved just before live model work and given back unless model tokens
  may have been spent.
- The cache key holds the model id and the canonicalize, procedure,
  scheduler, review and compile versions. Bumping any of them makes every
  URL convert live again, so run `npm run warm` after such a deploy.
  Dietary, cuisine, scaling and voice versions are not in the key.
- The allergen floor only adds tags. An allergen named only in an
  alternative ("or vegan butter") becomes a trace, and "Replaces …" notes
  on substitutes are skipped.
- Three review judgments are advisory (AGENTS.md "Review checks"): their
  failures travel as `reviewNotes`, never as a block.
- The viewer colors lanes by position from src/lib/lane-palette.ts,
  whatever color an artifact stored; stored artifacts are never rewritten.
- Convert, adjust, photo and artifact POSTs that a browser marks
  `Sec-Fetch-Site: cross-site` get 403. The app's own pages and the /embed
  iframe are same-origin; curl, scripts and servers send no such header.
- The embed's same-page rule is a soft guard (Firefox has no
  `ancestorOrigins`, and a no-referrer host hides itself); the per-IP limit
  and the daily cap are the real budget guards.
- The skills API drops unknown body fields with an `unknown_field` warning
  and maps common allergen words ("dairy", "wheat") to EU-14 slugs with a
  warning, so assistants get fixable feedback instead of hard refusals.
