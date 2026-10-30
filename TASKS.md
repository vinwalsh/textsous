# Tasks

This file is the build plan and the definition of done. AGENTS.md says how to
build; this file says what to build next and how to prove it works.

## How to use this file (for the coding agent)
- Work one milestone at a time, in order. Within a milestone, work items in
  order unless the owner says otherwise.
- At the start of a session, name the current milestone and its first open item.
- Mark an item `[x]` only after its Check passed in this session. Add the date
  and one line of evidence under it, for example
  `  - 2026-10-28: npm test, 41 passed`.
- If an item is blocked, mark it `[!]` with one line saying why and what would
  unblock it, then continue with the next item.
- Checks that say "owner" need the owner to confirm in the session before the
  item is marked `[x]`.
- Do not edit, merge or delete items. Propose changes in your report instead.
- End every session with: items closed, items still open, blockers, tokens used.

## Done for every milestone
A milestone is done when all of these hold:
1. Every item in it is `[x]`.
2. `npm run typecheck`, `npm run lint` and `npm test` pass with MODEL_API_KEY
   unset. Tests use recordings, never a live model.
3. The latest CI run on main is green.
4. From M1 on, the latest main commit is deployed on Vercel, and
   `curl -fsS https://open.textsous.com/api/health` returns `"status": "ok"` with
   `"model": "muse-spark-1.3"`.
5. NEW-WORK.md has a dated line for each closed item, and the Status section of
   AGENTS.md is current.
6. `git ls-files` shows no .env* files, no keys, and no third-party recipe text,
   HTML, images or recordings.

## M1. Foundation and first conversion (target: Oct 28)
- [x] **M1.1 Scaffold.** Next.js 16 (App Router, TypeScript, ESM, Node 22) with
  src/lib as a pure TS library. package.json scripts: dev, build, start, test,
  typecheck, lint (`eslint .`), cli (`tsx src/cli.ts`), smoke.
  Check: `npm run build` succeeds.
  - 2026-10-28: `npm run build` green with key unset (routes /, /api/convert, /api/health); all scripts present as specified.
- [x] **M1.2 CI.** GitHub Actions on push and pull request: npm ci, typecheck,
  lint, test. No secrets in CI.
  Check: the run for the commit that adds it is green.
  - 2026-10-28: owner pushed the slice-1 commit and confirmed CI green; workflow matches spec (push/PR, ci/typecheck/lint/test, no secrets).
- [x] **M1.3 Canonical schema.** src/lib/schema/canonical.ts per AGENTS.md, plus
  a helper that emits inlined JSON Schema for response_format.
  Check: a test asserts the emitted schema has no `$ref`, every object has
  `additionalProperties: false`, and every property is in `required`.
  - 2026-10-28: 22/22 tests incl. the strictness test; a temp probe verified the no-$ref/strict/fully-required property at every depth (probe removed after).
- [x] **M1.4 Model client.** src/lib/model/ with `callStructured(schema,
  messages, opts)`: zod validation, up to 2 re-prompts with the errors, token
  usage returned, JSON-mode fallback, "meta" and "baseten" profiles, and the
  production refusal of `-contributor` model IDs.
  Check: tests with a fake transport cover first-try success, a fix on retry,
  failure after 3 tries, json_schema rejected then JSON mode, and the
  production contributor refusal.
  - 2026-10-28: injectable client seam + 5 fake-transport tests covering every check branch; 40/40 green, key unset.
- [x] **M1.5 URL intake.** src/lib/intake/url.ts: https only, no private IPs,
  10 s timeout, 2 MB cap, at most 3 redirects. Extract a schema.org Recipe from
  JSON-LD, including @graph and HowToSection/HowToStep; refuse pages with
  several recipes; fall back to readable text without JSON-LD; capture site,
  author and canonical URL for credit.
  Check: offline tests over fixtures for each branch, including each refusal.
  - 2026-10-28: 8 offline fetch-guard tests (scheme, private IP/host/DNS, redirects, cap, timeout, status/type) over stubbed fetch + fixtures; 40/40 green.
- [x] **M1.6 Text intake.** src/lib/intake/text.ts for pasted recipes.
  Check: offline test over the pasted-text fixture.
  - 2026-10-28: added fixture test reading herby-white-bean-toast.txt through extractFromText; 40/40 green.
- [x] **M1.7 Canonicalize stage.** src/lib/stages/canonicalize.ts: verbatim
  transcription, prep split from active steps, quantities as printed, EU-14
  allergens or empty. Deterministic checks against JSON-LD: ingredient count,
  servings, and every ingredient name present in the source.
  Check: recorded-response tests pass for all three fixtures, and a doctored
  fixture with a dropped ingredient fails the deterministic check.
  - 2026-10-28: --record flag (fixtures only) + 4 replay tests over 3 recordings + 1 doctored; live record 6580/4245/7216 tokens, all checks pass first try.
- [x] **M1.8 Fixtures and recordings.** Three original recipes written for this
  repo in eval/fixtures: a JSON-LD HTML page, a plain HTML page, pasted text.
  Third-party recipes appear only as lines in eval/urls.txt.
  `npm run cli -- convert <fixture> --record` saves model responses to
  eval/recordings/, for our fixtures only.
  Check: `npm test` passes with MODEL_API_KEY unset.
  - 2026-10-28: `npm test` 22/22 with MODEL_API_KEY unset; 3 fixtures present, urls.txt holds no recipe content.
  - 2026-10-28: follow-up: the `--record` flag named above is now implemented (fixtures only) with 3 recordings committed.
- [x] **M1.9 CLI.** `npm run cli -- convert <url|file> --out <path>
  [--provider meta|baseten]` and `npm run smoke`.
  Check: smoke prints the model id and token usage; convert on each fixture
  writes JSON that validates against the canonical schema.
  - 2026-10-28: smoke meta/muse-spark-1.3, 314 tokens; all 3 fixtures converted first-try with checks passing, outputs schema-valid (6073/4729/7184 tokens).
- [x] **M1.10 Web and API.** Placeholder home page. GET /api/health returns
  status, provider, model and key/Upstash/cap flags. POST /api/convert takes {url} or
  {text} and sits behind the per-IP rate limit, the daily cap and the cache
  (Upstash in production, filesystem in dev).
  Check: locally, the same input twice returns the second from cache with zero
  tokens; exceeding a lowered limit returns 429; the production health check
  passes (needs O1 and O2).
  - 2026-10-28: local clauses verified in-process (cache hit zero tokens; 429 on lowered cap + 20/hr); prod /api/health green (status ok, muse-spark-1.3, key + Upstash true).

## M2. Cook Along (target: Oct 30)
- [x] **M2.1 Schemas.** src/lib/schema/timeline.ts and artifact.ts per AGENTS.md,
  including formatVersion and credit.
  Check: the same JSON Schema assertions as M1.3.
  - 2026-10-28: timeline.ts + artifact.ts with formatVersion/credit; deep strictness assertions on both emitted schemas; timeline.json + artifact.json generated; 44/44 green.
- [x] **M2.2 Procedure stage.** src/lib/stages/procedure.ts: component lanes
  plus a final kitchen lane; phases prep/cook/finish; hands-on split from
  unattended work; sourceStepIds on every task; one exact quote per "source"
  timing, "estimate" otherwise; resource holds for pans, burners and oven;
  24k output tokens.
  Check: for each fixture, the output validates, every sourceStepId exists, and
  every quote appears verbatim in the source.
  - 2026-10-28: procedure.ts + 5 coded checks + CLI procedure cmd; all 3 fixtures pass first try (13.5k/13.8k/13.0k tokens); 3 recordings + replay tests; 54/54 green.
- [x] **M2.3 Scheduler.** src/lib/scheduler/schedule.ts, deterministic: one cook,
  so hands-on tasks never overlap; unattended tasks overlap freely;
  dependencies and resource holds respected; all prep before the first cook
  task; serve task last. Returns start and end minutes, the critical path and
  total time.
  Check: hand-written cases with known answers pass for each rule.
  - 2026-10-28: deterministic list scheduler + 10 known-answer tests (one per rule + cycle/contract guards); fixtures schedule to 14/16/12m; 64/64 green.
- [x] **M2.4 Review.** src/lib/stages/review.ts runs the 12 checks. In code:
  ingredient_coverage, mise_en_place, task_schedule, source_timing,
  atomic_attention (no hands-on task over 15 minutes without a checkpoint).
  The rest in one model call returning pass/fail and a sentence each. A failed
  check blocks compile with a readable reason.
  Check: each coded check has a passing and a failing test.
  - 2026-10-28: review.ts (5 coded + 7 judged, blockers gate compile) + 14 tests incl. mapping; live review passes 3/3 fixtures (5.3k/3.8k/4.3k tokens); 78/78 green.
- [x] **M2.5 Compile.** src/lib/stages/compile.ts assembles the Cook Along
  artifact; `changes` lists merged steps and estimates.
  Check: the artifact for each fixture validates against the schema.
  - 2026-10-28: compile.ts (credit copy, allergen roll-up, method derivation, changes, review gate) + 7 tests; artifacts VALID for 3/3 fixtures; 85/85 green.
- [x] **M2.6 CLI and API.** `convert` writes the full artifact; `--timeline`
  prints a text Gantt; /api/convert returns the artifact.
  Check: run on all fixtures and report task count, total time, failed checks
  and tokens per call.
  - 2026-10-28: pipeline module + convert→artifact + --timeline + /api/convert→artifact (cache v2); 3/3 pass, 0 failed checks (8t/17m/24.4k, 5t/16m/17.3k, 4t/12m/22.2k); 91/91 green.

## M3. Adjustments (target: Oct 31)
- [x] **M3.1 Amounts.** src/lib/scaling/ parses fractions, mixed numbers,
  ranges and characters like ½, with a unit table.
  Check: table-driven tests with known answers.
  - 2026-10-29: amounts.ts (fractions/mixed/ranges/vulgar) + units.ts (~40 aliases); 44 table-driven tests; number extractors for later stages.
- [x] **M3.2 Scaling.** `scaleIngredient(ingredient, factor)` returns cook and
  buy amounts under the rules linear, sublinear, flat, superlinear and
  to-taste; servings stay between 0.5 and 12. One model call assigns a rule
  and reason per ingredient; code does all the math. Numbers in step text that
  map to a scaled ingredient are rescaled; others are flagged.
  Check: known-answer tests, the bounds, and a step-number rescale test.
  - 2026-10-29: scaleIngredient (cook/buy, 5 curves) + assignScaleRules + applyScaling (bounds, rescale+flags); 17 tests.
- [x] **M3.3 Dietary.** src/lib/stages/dietary.ts produces the variant transform
  for the seven targets. Code applies swaps and step overrides and recomputes
  allergens; unknown stays unknown.
  Check: each target produces a valid transform on at least one fixture, and
  the recomputed allergens drop the restricted ones.
  - 2026-10-29: dietary.ts (plan+apply, 7 targets) + shared applier; live all 7 on porridge, valid transforms, restricted absent (19.2k tokens).
- [x] **M3.4 Voice.** src/lib/stages/voice.ts rewrites label, description and
  completionCue in SOUS's voice. Numeric tokens stay unchanged and in order;
  otherwise retry, then keep the original text.
  Check: the numeric-token test and the fallback test pass.
  - 2026-10-29: voice.ts (verify per field, selective retry, keep-original fallback); 6 tests incl. retry-success and omission.
- [x] **M3.5 Cuisine infusion.** Cut this first if behind schedule.
  src/lib/stages/cuisine.ts uses the shared transform: keep the dish's identity
  and method, swap at most a third of the ingredients, prefer aromatics, fats,
  acids, herbs and finishing touches, list techniqueChanges separately, give a
  one-sentence rationale per swap. Code refuses transforms that change timings,
  and a dietary variant applied earlier still holds.
  Check: gluten-free then Italian never reintroduces a gluten ingredient, and
  a timing-changing transform is refused.
  - 2026-10-29: cuisine.ts (plan+apply, third-budget + timing + reintroduction guards); live gf→Italian clean, no gluten back (8.3k tokens).
- [x] **M3.6 Composition.** CLI flags `--servings`, `--dietary`, `--cuisine` and
  `--voice sous`, applied in that order; POST /api/adjust does the same.
  Check: all four flags together produce a valid artifact on two fixtures.
  - 2026-10-29: adjustArtifact (fixed order) + convert flags + /api/adjust; live 4-flag runs VALID on porridge (43.0k) + corn (31.0k); 180/180 green.

## M4. Photo, web flow and handoff (target: Nov 2)
- [x] **M4.1 Photo intake.** src/lib/intake/photo.ts: PNG, JPEG or WebP up to
  5 MB, sent as an image_url data URL in a user message for a verbatim
  transcription with any visible book title, author and page, then
  canonicalize. Status is always needs_review. The image is never written to
  disk, cache or logs.
  Check: tests for the size and type limits, and a test that nothing stores
  the image bytes.
  - 2026-10-29: intake/photo.ts + POST /api/photo (multipart "photo"); 18 tests green; live herby PNG: 7/7 ingredients, 4/4 steps, book/author/page captured, needs_review (10.4k tokens).
- [ ] **M4.2 Flow.** Mobile-first pages: home (paste a URL, paste text, or take
  or upload a photo; accepts ?url= and ?src=), a photo confirm screen beside
  the photo, the viewer (credit card, Mise en Place, lane timeline, step cards
  with completionCue and timers), and an adjust panel with a "what changed"
  list.
  Check: owner completes each path on a phone against production.
  - 2026-10-29: UI built (intake + confirm + viewer + adjust) + /api/convert {recipe}; gates green (200/200), live recipe-path VALID (13.2k), render smoke 17/17. Owner phone check pending (needs push + deploy).
- [x] **M4.3 Save to TextSous.** Store the artifact for 24 hours. GET
  /api/artifact/<id>?sig= checks an HMAC over the id and expiry, can be
  fetched more than once, and returns 404 after expiry. The button redirects
  to https://textsous.com/import?src=<signed URL>.
  Check: tests for valid, tampered and expired signatures and for the
  redirect URL.
  - 2026-10-29: artifact-store (HMAC id+expiry, Upstash/filesystem, 24h TTL) + POST/GET routes + viewer Save button → import redirect; 14 tests (valid/tampered/expired/redirect), 214/214 green.
- [x] **M4.4 Published docs.** `npm run schema` writes docs/schema/*.json;
  docs/FORMAT.md is generated from the zod schemas; docs/EMBED.md holds the
  "Open with TextSous" snippet with utm_source and utm_medium.
  Check: CI regenerates the files and fails if the committed copies differ.
  - 2026-10-29: scripts/generate-format.ts + npm run docs (173 field lines, deterministic); EMBED.md snippet; CI gate (schema + docs + git diff --exit-code).
- [x] **M4.5 Hardening.** Friendly pages for refused URLs, timeouts and an
  exhausted cap; health reports provider and cache; logs carry no URLs of
  private recipes; footer with the takedown contact and the privacy note.
  Check: tests for each error path and for log redaction; footer present
  (needs O5).
  - 2026-10-29: friendly error copy + ErrorBox + apiFetch timeout wired into all flows; redacting logEvent in 3 routes; footer with O5 contact. 26 tests; 240/240 green. Health already reported provider + cache (no change).
- [ ] **M4.6 Performance.** Measure p50 and p95 latency per stage and tokens per
  conversion over the fixtures and three URLs from eval/urls.txt.
  Check: the numbers are in the session report.
  - 2026-10-29: fixtures measured (n=3, 0 failed checks): canon p50 30.3s/p95 42.5s, procedure p50 64.0s/p95 80.1s, review p50 17.7s/p95 32.3s, tokens p50 20.1k/p95 24.6k (64.8k total). URL portion BLOCKED: sandbox egress fails environment-wide (3 hosts + 2 channels); needs a networked env. urls.txt still unpopulated (no unverified guesses); M5.1 populates + verifies there.

## M5. Proof and disclosure (target: Nov 3)
- [ ] **M5.1 Eval.** `npm run eval` runs the fixtures and the 20 URLs in
  eval/urls.txt (fetched at run time, never committed). It scores review
  checks passed, ingredient coverage, share of timings with source evidence,
  scheduled vs source total time, latency, tokens and cost, and writes
  eval/RESULTS.md.
  Check: RESULTS.md has 23 rows and no third-party text.
- [ ] **M5.2 Demo set.** Pre-warm the production cache with the 20 URLs, and
  list them on a /demo page.
  Check: each returns from cache in production.
- [ ] **M5.3 NEW-WORK.md.** What was built Oct 27 to Nov 4 with the commit range,
  what pre-existed outside this repo, and the exact changes made in the private
  TextSous repo for the handoff.
  Check: owner review.
- [ ] **M5.4 README.** What it does, a 60-second quickstart, provider setup, the
  spec link, the embed snippet, limits, license, and the credit and takedown
  policy.
  Check: a clean clone follows the quickstart to a converted fixture.
- [ ] **M5.5 Final state.** AGENTS.md Status lists what is built; production
  health reports the Standard tier; HTTPS is valid; CI is green.
  Check: every "Done for every milestone" condition holds.

## Owner actions (not for the coding agent)
- [x] O1 Re-add the Meta key in Vercel as MODEL_API_KEY (Production and
  Preview, Sensitive) and delete `model_api_key`. Needed for M1.10.
  - 2026-10-28: owner confirmed key set and legacy var deleted; prod /api/health shows hasApiKey true.
- [x] O2 Add Upstash for Redis from the Vercel Marketplace and connect it to
  open-textsous. Needed for M1.10.
  - 2026-10-28: owner connected store textsous_cache + manual UPSTASH_* vars; prod health confirms upstashConfigured true.
- [ ] O3 Set DAILY_CONVERSION_CAP and the rate limit once M1 reports tokens per
  conversion.
- [ ] O4 Add the Baseten key if credits are approved (optional fallback).
- [x] O5 Choose the takedown and privacy contact address. Needed for M4.5.
  - 2026-10-29: owner chose privacy@textsous.com; footer shipped in M4.5.
- [ ] O6 Build /open and /import on textsous.com in the private repo by Nov 1.
- [ ] O7 Add the imported-recipes line to the textsous.com privacy policy.
- [ ] O8 Record the three-minute demo video (Nov 3).
- [ ] O9 Submit on the Cerebral Valley platform by Nov 4, 9:00 PM ET, with the
  public repo and a public video link.
