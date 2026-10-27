# textsous

## What this is
textsous.com is a SMS/MCP-first production web app that helps people manage their
weekly meal plan - this repo holds the open source tools that are offered by SOUS AI
including (but not limited to) TypeScript library and CLI that converts any recipe (URL,
pasted text, cookbook photo) into the Sous Cook Along format: a canonical recipe
JSON, a component-lane cooking timeline, and adjustable variants (servings,
dietary, cuisine infusion, Sous voice). It runs at https://open.textsous.com and
hands finished recipes to https://textsous.com ("Open with TextSous", "Save to
Sous"). Built during the Meta Global AI Developer Hackathon on Meta Model API.
Everything in this repo is new work written during Oct 27 - Nov 4, 2026.

## Non-negotiables
- Model access goes through one client (`src/lib/model/`). Config from env:
  MODEL_BASE_URL (default https://api.meta.ai/v1), MODEL_API_KEY, MODEL_ID
  (default muse-spark-1.3-contributor). A second provider profile targets Baseten with
  MODEL_ID meta-models/muse-spark-open-1026. Never hardcode keys.
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
  page for photos. Source images are never copied. Fixtures and eval data come
  only from recipes we own or that are public domain / CC-licensed with
  attribution; third-party recipes are stored as URLs and fetched at run time.
  Never commit third-party HTML, text or images.
- Production. The app deploys to Vercel on every push to main. Conversions are
  cached by normalized URL + stage versions (Upstash Redis in prod, filesystem in
  dev). Per-IP rate limit on live conversions, a daily global conversion cap from
  env, `/api/health`, structured logs without PII, friendly error states.
- The voice stage changes wording only; numeric tokens stay unchanged, in order.
- Stages are pure, versioned functions (JSON in, JSON out).
- Tests: vitest fixture tests per stage; `npm test`, `npm run typecheck` and
  `npm run lint` pass before any task is reported done.
- Dependencies allowed without asking: next, react, openai, zod,
  zod-to-json-schema, cheerio, commander, vitest, tsx, typescript,
  @upstash/redis, @upstash/ratelimit. Ask before adding anything else.
- Do not commit or push. No cookies or tracking in the library; the web app may
  use Plausible via env.

## The format (spec)
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
  { recipe: { title, servings, ingredients, equipment, steps, allergens,
      originalMethod, methodLabel, methodNotice, credit },
    timelineDefinition, equipmentProfile, changes: [] }

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

## Layout
src/lib/ (pure TS, no Next imports: schema, model, intake, stages, scheduler,
scaling)  src/app/ (Next.js routes and UI)  src/cli.ts  eval/  docs/FORMAT.md
docs/EMBED.md  NEW-WORK.md

## Working style
Small verifiable tasks. After any stage change, run the CLI on eval/fixtures and
report what changed, which checks failed, and tokens per call.
