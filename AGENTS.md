# TextSous open-source tools

## What this is
TextSous is a meal-planning platform from SOUS AI LLC. People plan their week by
texting SOUS, the platform's assistant, or by talking to SOUS from an AI
assistant over MCP. This repo holds the platform's open-source tools, starting
with a TypeScript library, CLI and web app that convert any recipe (URL, pasted
text, cookbook photo) into the TextSous Cook Along format: a canonical recipe
JSON, a component-lane cooking timeline, and adjustable variants (servings,
dietary, cuisine infusion, SOUS voice). The app is meant to run at
https://open.textsous.com and hand finished recipes to https://textsous.com
("Open with TextSous", "Save to TextSous"). Started at the Meta Global AI
Developer Hackathon on Meta Model API. Everything built from Oct 27 to Nov 4,
2026 is hackathon work; NEW-WORK.md records it.

## Status (read first)
- On Oct 27, 2026 this repo holds only LICENSE, README.md, TASKS.md and this
  file. Nothing described below is built yet. The sections below are the rules
  and the target design. Never assume a module, script, route, env var or
  deployment exists until you have created it or checked for it.
- Vercel project `open-textsous` (team Sous) deploys this repo's main branch.
  Until package.json exists, its ignored-build-step rule skips every build.
  open.textsous.com is attached and its DNS points to Vercel; it serves
  nothing until the first deploy.
  Env vars set in Vercel: MODEL_BASE_URL, MODEL_ID (muse-spark-1.3),
  ARTIFACT_SIGNING_SECRET. Not set yet: MODEL_API_KEY (see TASKS.md O1),
  Upstash, the daily cap.
- The rest of the TextSous platform lives in separate private repos. It already
  handles accounts, households, weekly meal plans, grocery lists and SOUS over
  text and MCP. It has no public recipe import: the /open and /import routes in
  "Handoff" are planned and will be built there separately. Until they exist,
  test the handoff against a local stub, never against textsous.com.
- Cuisine infusion doesn't exist anywhere yet, and the format has never been
  published before.
- 2026-10-27: scaffolded (package.json, Next.js 16 app, CI, vercel.json) and
  built slice 1: canonical schema, model client, URL/text intake, canonicalize
  stage, CLI, /api/health + /api/convert, 3 original fixtures, offline tests.
  Gates green; live smoke + 3 fixture converts pass (2026-10-27, Development
  key). Pinned to Node 22 everywhere (.nvmrc, CI, engines, types).
- 2026-10-28: M1 items all closed (TASKS.md): fake-transport, fetch-guard,
  fixture-text and recorded-response tests (40/40 green, key unset), --record
  flag + 3 recordings + 1 doctored; prod /api/health green (muse-spark-1.3,
  key + Upstash true). M1.4-M1.7 code not yet pushed.
- 2026-10-29: M3 adjustments complete (TASKS.md): amounts/scaling math,
  dietary + cuisine variants, SOUS voice, composition flags + /api/adjust.
  180/180 green, key unset. Not yet pushed.
- Keep this section current. When something ships, say so here with the date.

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
  you cannot see. Its contract is the "Handoff" section below plus the
  generated JSON Schemas in docs/schema/. Call out any change to either in
  your report.
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
  for closed sets, no recursive $ref (the API returns 400).
- Structured data is the source of truth. The model proposes; code validates and
  computes. Scaling math, the timeline schedule, allergen roll-ups and unit
  handling are code, never prose.
- Fidelity. Never invent ingredients, quantities or timings. Every timeline task
  cites `sourceStepIds`. A timing not in the source is `timingBasis: "estimate"`;
  a "source" timing carries one exact quote from the source.
- Safety. Missing allergen declarations mean unknown, never allergen-free.
  Dietary swaps list `packageRequirements` the cook must verify on the label.
  No nutrition or health claims anywhere in prompts, UI or docs.
- Rights and privacy. A converted recipe is private to the person who requested
  it; it is never listed, indexed or shared. Every recipe card shows credit:
  site name, author and a "View original" link for URLs; book title, author and
  page for photos. Source images are never copied. Uploaded photos are
  processed in memory and never stored or logged. Fixtures and eval data come
  only from recipes we own or that are public domain / CC-licensed with
  attribution; third-party recipes are stored as URLs and fetched at run time.
  Never commit third-party HTML, text or images.
- Production. The app deploys to Vercel on every push to main. Conversions are
  cached by normalized URL + stage versions (Upstash Redis in prod, filesystem in
  dev). Per-IP rate limit on live conversions, a daily global conversion cap from
  env, `/api/health`, structured logs without PII, friendly error states.
- The voice stage changes wording only; numeric tokens stay unchanged, in order.
- Stages are pure, versioned functions (JSON in, JSON out).
- Tests: vitest fixture tests per stage. Tests never call a live model; they
  use recorded responses under eval/recordings/, so CI runs without a key. Live
  calls happen only through `npm run smoke` and the CLI. `npm test`,
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

## Procedure rules (model must honor, code must check)
- Mise en place first: all prep tasks finish before the first cook task starts.
- One lane per component (sauce, protein, base, side, garnish) plus a kitchen lane.
- Split atomic hands-on work from unattended intervals.
- One cook; shared tasks execute once.
- Timers default on only for exact source durations.
- Resource holds for pans, burners and the oven; waits in multiples of 60 s.
- The scheduler (code) turns tasks, dependencies and holds into start and end
  minutes under the one-cook constraint. The model never schedules.

## Review checks
source_fidelity, ingredient_coverage, quantities, dietary_conditions,
method_and_safety, equipment_capacity, task_schedule, source_timing,
atomic_attention, mise_en_place, source_relationships, tips_and_voice.

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
- `npm run schema` regenerates docs/schema/*.json from the zod schemas. Run it
  after any schema change and keep the output committed: textsous.com validates
  against those files.

## Layout
Node 22, Next.js 16 App Router, TypeScript, ESM.
src/lib/ (pure TS, no Next imports: schema, model, intake, stages, scheduler,
scaling)  src/app/ (Next.js routes and UI)  src/cli.ts  eval/  docs/FORMAT.md
docs/EMBED.md  docs/schema/  NEW-WORK.md  TASKS.md

## Working style
TASKS.md is the build plan and the definition of done. Follow the rules at its
top: one milestone at a time, an item is `[x]` only after its Check passed in
the session, blocked items are `[!]` with a reason, and every session ends with
closed, open and blocked items. Keep tasks small and verifiable. After any stage
change, run the CLI on eval/fixtures and report what changed, which checks
failed, and tokens per call. End each item at a clean stopping point: tests
pass, one dated line appended to NEW-WORK.md saying what was built, and a
suggested commit message in your report.
