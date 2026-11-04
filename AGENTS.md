# TextSous open-source tools

## What this is
TextSous is a meal-planning platform from SOUS AI LLC. People plan their week by
texting SOUS, the platform's assistant, or by talking to SOUS from an AI
assistant over MCP. This repo holds the platform's open-source tools, starting
with a TypeScript library, CLI and web app that convert any recipe (URL, pasted
text, up to 3 cookbook photos of one recipe) into the TextSous Cook Along
format: a canonical recipe JSON, a component-lane cooking timeline, and
adjustable variants (servings, dietary, cuisine infusion, SOUS voice). The app
runs at https://open.textsous.com and hands finished recipes to
https://textsous.com ("Open with TextSous", "Save to TextSous"). Started at the
Meta Global AI Developer Hackathon on Meta Model API. Everything built from
Oct 27 to Nov 4, 2026 is hackathon work; NEW-WORK.md records it.

## Status (read first)
Updated 2026-11-04. Keep this section current: when something ships, say so
here with the date. Check the code before trusting any doc line about it.

- Live: M1-M7 (TASKS.md) on main. Vercel project `open-textsous` deploys
  main to https://open.textsous.com on every push. CI runs typecheck, lint,
  the offline tests and the schema/docs diff gate.
- M7 went live on Nov 4 at 04:17 ET: main fast-forwarded from `3e56ebb` to
  `f92e0a1` (93 commits, Nov 3-4, docs included). It brought fixes from the
  Nov 3 review, the cook-along output format, the EU-14 allergen floor, new
  limits and timeouts, the skills API, the /assistants page, the Cook Along
  button (embed.js, /embed, /embed-demo), the TextSous brand pass, advisory
  review judgments, a final round of review fixes and a review of those
  fixes. CI is green on `f92e0a1`. Live model checks: four conversions on a
  Vercel preview of the core stream before the merges, one on a preview of
  the final branch, then the production checks and the 17 fresh conversions
  of the demo warm (TASKS.md M7.10, O12).
- What the M7 deploy changed in production:
  - Stage versions moved (canonicalize 2, procedure 4, review 2, compile 2),
    so the /demo URLs had to be converted again. All 20 and the /embed-demo
    post were warmed on Nov 4 (TASKS.md O12). Warm again after any deploy
    that changes a stage version:
    `npm run warm -- --base https://open.textsous.com`.
  - The code defaults are 300 live conversions a day and 20 an hour per IP
    per route (before M7 the default was 100 a day). Neither
    DAILY_CONVERSION_CAP nor RATE_LIMIT_PER_HOUR is set in Vercel.
  - The secret skills routes answer 503 `not_configured` until
    SKILLS_API_SECRET is set; `GET /api/skills/format` works regardless.
  - "Save to TextSous" opens textsous.com/import, which is 404 until the
    TextSous app's Cookbook import PR ships. A build with
    NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off hides the button.
- Vercel env today: MODEL_API_KEY, MODEL_BASE_URL, MODEL_ID,
  ARTIFACT_SIGNING_SECRET, UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN;
  Baseten values on Preview and Development only. Not set: SKILLS_API_SECRET,
  DAILY_CONVERSION_CAP, RATE_LIMIT_PER_HOUR, PUBLIC_ORIGIN. Preview and
  production share one Upstash database (cache, limits, daily counter).
- The rest of the TextSous platform lives in private repos: accounts,
  households, weekly meal plans, grocery lists, SOUS over text, and the
  TextSous MCP server at https://textsous.com/api/mcp (OAuth sign-in, live).
  Its side of the handoff is written but not merged: a Cookbook import PR
  (the /open redirect, the /import funnel, the imported-recipes privacy line)
  and an MCP recipe-tools change stacked on it (get_cook_along_format,
  get_recipe_source and save_cook_along, which call the skills API). Until
  they ship, textsous.com/open and /import return 404: test the handoff
  against a local stub or a preview, never against textsous.com.
- Pending on the owner (TASKS.md owner actions, in order): the skills secret
  on both projects, the TextSous app merges, one Muse end-to-end test, phone
  checks, the demo video, and the submission by Nov 4, 9:00 PM ET. The M7
  deploy and the demo warm are done.
- Open decisions (HANDOFF.md, "Open loops"): /embed starts an uncached
  conversion without a tap; closing the overlay does not stop the server's
  conversion, so reopening too soon starts a second one; the skills secret
  budget stays at 600 requests an hour.

## Names (use exactly)
- TextSous: the public name of the platform and of this project, in UI copy,
  docs and links ("Open with TextSous", "Save to TextSous").
- SOUS: the assistant persona that texts people and answers over MCP. Use it
  only when the assistant itself speaks or acts ("SOUS will text you the
  steps"). The voice stage writes in SOUS's voice.
- SOUS AI LLC: the company. Use it only in legal text: license, terms, privacy
  notice, copyright lines.

## Boundaries
- Work only inside this repo. Do not read, search, copy or reference any other
  directory on this machine, especially ~/Documents/sous-app and
  ~/sous-worktrees. The platform's code is private, and this repo is a
  clean-room build from the spec below.
- The textsous.com side of the handoff is built separately, in a private repo
  you cannot see. Its contract is the "Handoff" section below, the generated
  JSON Schemas in docs/schema/ and the skills API in docs/SKILLS.md, which
  its MCP server calls. Call out any change to any of them in your report.
- Never open, print or commit .env* files or API keys. Refer to variables by
  name only.

## Non-negotiables
- Model access goes through one client (`src/lib/model/`). Config from env:
  MODEL_BASE_URL (default https://api.meta.ai/v1), MODEL_API_KEY, MODEL_ID
  (default muse-spark-1.3). A second provider profile targets Baseten with
  fixed model meta-models/muse-spark-open-1026, via BASETEN_BASE_URL and
  BASETEN_API_KEY (falling back to MODEL_BASE_URL and MODEL_API_KEY).
  Never hardcode keys.
- Contributor-tier model IDs (ending in `-contributor`) let Meta train on
  prompts and outputs. They are allowed only for local runs on fixtures we
  wrote. In production, refuse to run a conversion with one, and make
  `/api/health` report it as an error.
- Use the Chat Completions API (`client.chat.completions.create`). Images go
  only in user-role messages, as `image_url` data URLs. (On the Responses API
  the structured-output parameter is `text.format`; `response_format` there
  returns 400.)
- Every model call asks for JSON. Prefer `response_format: { type: "json_schema",
  json_schema: { name, schema } }`. If a provider rejects json_schema, fall back
  to JSON mode and rely on zod validation. Either way: validate with zod,
  re-prompt with the validation errors up to 2 times, never loosen the schema.
- JSON Schema is generated from zod with `zodToJsonSchema(s, { $refStrategy:
  "none" })`: `additionalProperties: false`, every field in `required`, `enum`
  for closed sets, no recursive $ref (the API returns 400). That is the
  model-facing schema; the published docs/schema/*.json leave optional fields
  out of `required`.
- Structured data is the source of truth. The model proposes; code validates and
  computes. Scaling math, the timeline schedule, allergen roll-ups and unit
  handling are code, never prose.
- Fidelity. Never invent ingredients, quantities or timings. Every timeline task
  cites `sourceStepIds`. A timing not in the source is `timingBasis: "estimate"`;
  a "source" timing carries one exact quote from the source.
- Safety. Missing allergen declarations mean unknown, never allergen-free.
  Dietary swaps list `packageRequirements` the cook must verify on the label.
  No nutrition or health claims anywhere in prompts, UI or docs. A
  deterministic EU-14 floor (`src/lib/allergens.ts`) adds the allergens an
  ingredient's name plainly implies, and possible ones as traces ("May
  contain"); it never removes a tag.
- Rights and privacy. A converted recipe is private to the person who requested
  it; it is never listed, indexed or shared. Every recipe card shows credit:
  site name, author and a "View original" link for URLs; book title, author and
  page for photos. Source images are never copied. Uploaded photos are
  processed in memory and never stored or logged. Fixtures and eval data come
  only from recipes we own or that are public domain / CC-licensed with
  attribution; third-party recipes are stored as URLs and fetched at run time.
  Never commit third-party HTML, text or images.
- Production. The app deploys to Vercel on every push to main. Conversions are
  cached for 30 days by normalized URL + stage versions + model id (Upstash
  Redis in prod, filesystem in dev); cache hits are served first and are free.
  Live work sits behind a per-IP hourly limit per route (RATE_LIMIT_PER_HOUR,
  default 20) and a global daily cap (DAILY_CONVERSION_CAP, default 300; 0
  pauses live conversions); a daily unit is kept only once model tokens may
  have been spent. POSTs a browser marks `Sec-Fetch-Site: cross-site` get
  403. Route deadlines stay under the function limits (convert 420 s, adjust
  and photo 300 s). `/api/health`, structured logs without PII, friendly
  error states.
- Skills API (docs/SKILLS.md). `GET /api/skills/format` is public.
  `POST /api/skills/source` and `POST /api/skills/cook-along` need
  `Authorization: Bearer <SKILLS_API_SECRET>`, compared in constant time; with
  the secret unset they answer 503 `not_configured`, never open access. The
  secret is shared only with the TextSous app, server to server (where it is
  TEXTSOUS_OPEN_SKILLS_SECRET); never send it to a browser or put it in
  client code. Skills routes never call a model and never use the daily cap;
  they have their own limits (600 requests an hour per secret, 60 an hour
  per `X-TextSous-Account`).
- Embed (docs/EMBED.md). Only `/embed` may be framed by other sites
  (`frame-ancestors *`); every other route sends `frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`. Same-page rule: `/embed` converts a `?url=`
  only when its host matches the embedding page's (from
  `location.ancestorOrigins`, else the referrer; `www.` ignored, a subdomain
  of the same site counts) and proceeds when the browser reports neither. It
  is a soft guard, not access control. Every link inside `/embed` opens in a
  new tab. embed.js sets no cookies and sends nothing until a reader taps
  the button.
- Progressive conversion (M8, `src/lib/convert-events.ts` is the contract).
  POST /api/convert with `Accept: application/x-ndjson` answers 200 with
  one JSON event per line: facts -> overview -> recipe -> procedure -> done,
  or one `error` event `{status, error}` with the status and message the
  JSON answer would have had. Every check before live work (cross-site 403,
  body 400s, page fetch errors, size caps, both 429s) keeps its JSON answer;
  a cache hit streams one `done`. Facts go out before any model call when
  the page has a schema.org Recipe, otherwise with the overview; the
  overview is sent whenever it arrives before compile. A blank line every
  15 s keeps the connection open (readers skip it). A reader who leaves
  does not stop the work (after() keeps the function alive) and URL
  results are still cached. Without the header, JSON answers are unchanged
  and no overview call runs.
- Overview stage (`src/lib/stages/overview.ts`, version 1): one fast call
  (title, posted servings, ingredient count, stated total time, definite
  EU-14 allergens, a calm summary, up to six components) alongside
  canonicalize, or procedure on the {recipe} path. Streaming only; never
  cached, never in the artifact; nothing waits for it and its failure never
  fails a conversion. Its tokens count once it finished.
- Reasoning effort per stage (`src/lib/model/efforts.ts`). Code defaults:
  overview and scaling `minimal`; canonicalize, procedure, review, dietary,
  cuisine, voice and transcribe `low`. `REASONING_EFFORT_<STAGE>` (e.g.
  `REASONING_EFFORT_PROCEDURE=minimal`) overrides one stage; values other
  than minimal, low, medium, high and xhigh are ignored. `high` is Meta's
  default (the pre-M8 behavior). The `x-textsous-efforts` request header
  ("procedure=minimal,review=low") is honored on convert and adjust only
  when `VERCEL_ENV=preview`. Efforts are not part of the cache key and
  never bump a stage version. A provider that refuses an effort gets the
  call again without it. The convert log line records the efforts sent,
  per-stage timings and the overview outcome, for tuning from Vercel logs.
- The voice stage changes wording only; numeric tokens stay unchanged, in order.
- Stages are pure, versioned functions (JSON in, JSON out).
- Tests: vitest fixture tests per stage. Tests never call a live model; they
  use recorded responses under eval/recordings/, so CI runs without a key. Live
  calls happen only through `npm run smoke`, `npm run eval` and the CLI;
  `npm run warm` spends live conversions on a deployed site. `npm test`,
  `npm run typecheck` and `npm run lint` pass before any task is reported done.
  Next.js 16 has no `next lint`; `npm run lint` runs `eslint .`.
- Dependencies allowed without asking: next, react, react-dom, openai, zod,
  zod-to-json-schema, cheerio, commander, vitest, tsx, typescript, eslint,
  eslint-config-next, @types/node, @types/react, @types/react-dom,
  @upstash/redis, @upstash/ratelimit. Ask before adding anything else.
- Do not commit or push. No cookies or tracking in the library; the web app may
  use Plausible via env.

## The format (spec)
This repo is where the format is defined publicly. It is a draft (version 1)
until the first release; build exactly what is written here.

Canonical recipe (`src/lib/schema/canonical.ts`):
  { version: 1, id, title,
    source: { kind: "url"|"text"|"photo", url?, site?, author?, book?, page?,
              license? },
    cuisine?, nativeServings, servingsLarge?, scalingNotes?,
    ingredients: [{ id, name, quantity (free text like "1 1/2"), unit, quantity4?,
      scaleRule?: "linear"|"sublinear"|"flat"|"superlinear"|"to-taste",
      allergens: [EU-14 codes], allergenTraces: [], note? }],
    steps: [{ id, kind: "prep"|"active", text }],
    equipment: [], sourceFingerprint }
  Prep steps are mise en place and are SEPARATE from ordered active steps.

Timeline definition (`src/lib/schema/timeline.ts`):
  lanes: [{ id, label, color, kind: "component"|"kitchen" }], kitchen lane last;
  phases: "prep"|"cook"|"finish";
  tasks: [{ id, phase, label, cardTitle: { action, subject, context }, description,
    completionCue, minutes (1-180), range?, timingBasis: "source"|"estimate",
    attention: "hands-on"|"unattended", timerEnabledByDefault, laneIds,
    dependencies, sourceStepIds, checkpoints: [], tip?,
    equipmentEvent?: "oven-on"|"oven-off",
    scheduling: { waits: [], resourceIds: [], ingredientIds: [] } }];
  resources: [] (pans, burners, oven), resourceHolds: [], serveTaskId.

Cook Along artifact (`src/lib/schema/artifact.ts`):
  { formatVersion: 1, id,
    recipe: { title, servings, ingredients, equipment, steps, allergens,
      originalMethod, methodLabel, methodNotice,
      credit: { kind, site?, author?, url?, book?, page?, license? } },
    timelineDefinition, equipmentProfile, changes: [] }
  `credit` is copied from the canonical recipe's `source`. A change that would
  break artifacts already saved on textsous.com bumps formatVersion.

Variant transform (dietary and cuisine share it, `src/lib/schema/variant.ts`):
  { kind: "dietary"|"cuisine", target, titleOverride?,
    swaps: [{ fromIngredientId, to: { name, quantity, unit } | null, omitReason?,
      reason, packageRequirements: [] }],
    stepOverrides: [{ stepId, text }], techniqueChanges: [], rationale: [] }
  Dietary targets: dairy-free, egg-free, gluten-free, nut-free, soy-free,
  vegetarian, vegan. Cuisine targets: free text (e.g. "Italian", "Thai").

Optional fields added since the draft (nullish; formatVersion stays 1): on the
artifact, `recipe.nativeServings` and `reviewNotes: [{ check, status:
"failed"|"not_judged", detail }]`; on timeline tasks, `why` (one sentence); on
the variant transform, `taskOverrides: [{ taskId, label?, description?,
completionCue?, checkpoints? }]`. docs/FORMAT.md, generated from the zod
schemas, lists every field.

## Procedure rules (model must honor, code must check)
- Mise en place first: all prep tasks finish before the first cook task starts.
- One lane per component (sauce, protein, base, side, garnish) plus a kitchen lane.
- Split atomic hands-on work from unattended intervals.
- One cook; shared tasks execute once.
- Timers show on every step; estimated timings are labeled as estimates
  (M6.6 unified the display — `timerEnabledByDefault` stays in the data).
- Resource holds for pans, burners and the oven; waits in multiples of 60 s.
- The scheduler (code) turns tasks, dependencies and holds into start and end
  minutes under the one-cook constraint. The model never schedules.
- Output format (M7, procedure v4): one prep task per preparation named in an
  ingredient line or note; the oven preheat is the first prep task, and the
  first oven task after it waits 10 minutes from the preheat's end; task
  descriptions carry exact amounts with unit and ingredient, while card
  titles never carry amounts, times or temperatures; a batch is one grouped
  task (rounds x per-round time, an estimate with a range); short hands-on
  setup is split from unattended waiting; prepared inputs (cooked pasta,
  rice) get a task in their lane; at most one tip and an optional
  one-sentence `why` per task. `src/lib/format.ts` repairs titles, card
  titles and timing labels after the model.

## Review checks
source_fidelity, ingredient_coverage, quantities, dietary_conditions,
method_and_safety, equipment_capacity, task_schedule, source_timing,
atomic_attention, mise_en_place, source_relationships, tips_and_voice.
- Five are coded (ingredient_coverage, task_schedule, source_timing,
  atomic_attention, mise_en_place); one model call judges the other seven.
- Blocking: the five coded checks and the source_fidelity, quantities,
  dietary_conditions and method_and_safety judgments. A failed or missing
  judgment blocks compile; the web app shows one calm sentence with the
  reasons behind "Details".
- Advisory (since M7): equipment_capacity, source_relationships and
  tips_and_voice. A failed or missing judgment becomes a readable note in the
  artifact's optional `reviewNotes`, shown under "Notes on this conversion";
  it never blocks compile.
- A recipe an AI assistant writes through the skills API gets the coded
  checks only: the seven judgments are recorded as not run (`notRun`) and
  never block.
- Format warnings (prep_not_covered, amount_missing, batch_round_timing) are
  coded and never block.

## Handoff to textsous.com (the other side is private; this is the contract)
- Entry links: https://textsous.com/open?url=<recipe page URL> or
  ?src=<artifact JSON URL>. textsous.com redirects /open to
  https://open.textsous.com with the query string kept, so this app's home
  route accepts `url` and `src` and starts a conversion or loads the artifact.
- "Save to TextSous": store the artifact under a random id for 24 hours, then send
  the person to https://textsous.com/import?src=<signed artifact URL>.
- GET /api/artifact/<id>?sig=<signature> returns the artifact JSON. The
  signature is an HMAC of the id and expiry using ARTIFACT_SIGNING_SECRET. The
  URL works for 24 hours and may be fetched more than once, because sign-in can
  interrupt the first attempt. It returns 404 once expired. textsous.com fetches
  it server to server, so no CORS.
- Skills API (docs/SKILLS.md): the TextSous MCP server calls
  `POST /api/skills/source` and `POST /api/skills/cook-along` server to server
  with the shared secret, then imports the returned `artifactUrl` into the
  person's Cookbook. `artifactUrl` keeps exactly the import shape
  `<origin>/api/artifact/<lowercase uuid>?sig=<64 lowercase hex>`, with
  nothing else in the query; textsous.com accepts no other shape.
- `npm run schema` regenerates docs/schema/*.json from the zod schemas. Run it
  after any schema change and keep the output committed: textsous.com validates
  against those files.

## Layout
Node 22, Next.js 16 App Router, TypeScript, ESM.
- src/lib/ (pure TS, no Next imports): schema/, model/ (client, route
  budgets, per-stage efforts), intake/, stages/ (canonicalize, overview,
  procedure, review, compile, variants), scheduler/, scaling/, skills/ (the skills API:
  guide, input schema, normalize, validate, cook-along, source, http),
  format.ts (post-model format helpers and warnings), allergens.ts (EU-14
  floor), pipeline.ts, cache.ts, limits.ts, artifact-store.ts, handoff.ts,
  embed.ts, lane-palette.ts, review-notes.ts, variant-apply.ts,
  variant-text.ts, gantt.ts, eval-label.ts, log.ts, convert-events.ts (the
  NDJSON progress contract, client-safe).
- src/app/ (Next.js routes and UI): / (converter and viewer), /demo,
  /assistants, /embed (chrome-less, the only route other sites may frame),
  /embed-demo, api/convert, api/adjust, api/photo, api/artifact, api/health,
  api/skills/{format,source,cook-along}, api/helpers.ts.
- public/embed.js: the host-page script for recipe sites (plain JS, no build
  step).
- src/cli.ts; scripts/ (generate-schema, generate-format, eval, warm-demo).
- docs/FORMAT.md and docs/schema/ (generated), docs/EMBED.md, docs/SKILLS.md.
- eval/ (fixtures, recordings, urls.txt, RESULTS.md); tests/ (vitest, offline).
- README.md, HANDOFF.md, NEW-WORK.md, TASKS.md.

## Working style
TASKS.md is the build plan and the definition of done. Follow the rules at its
top: one milestone at a time, an item is `[x]` only after its Check passed in
the session, blocked items are `[!]` with a reason, and every session ends with
closed, open and blocked items. Keep tasks small and verifiable. After any stage
change, run the CLI on eval/fixtures and report what changed, which checks
failed, and tokens per call. End each item at a clean stopping point: tests
pass, one dated line appended to NEW-WORK.md saying what was built, and a
suggested commit message in your report.
