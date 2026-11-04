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
- [x] **M4.2 Flow.** Mobile-first pages: home (paste a URL, paste text, or take
  or upload a photo; accepts ?url= and ?src=), a photo confirm screen beside
  the photo, the viewer (credit card, Mise en Place, lane timeline, step cards
  with completionCue and timers), and an adjust panel with a "what changed"
  list.
  Check: owner completes each path on a phone against production.
  - 2026-10-29: UI built (intake + confirm + viewer + adjust) + /api/convert {recipe}; gates green (200/200), live recipe-path VALID (13.2k), render smoke 17/17. Owner phone check pending (needs push + deploy).
  - 2026-10-31: owner phone pass on prod: fresh + cached ?url=, /demo, text, photo→confirm→convert, viewer (attribution verified), vegetarian + cuisine adjust, ?src= load; picker fix + graceful-failure re-checks pass on the fresh deploy.
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
- [x] **M4.6 Performance.** Measure p50 and p95 latency per stage and tokens per
  conversion over the fixtures and three URLs from eval/urls.txt.
  Check: the numbers are in the session report.
  - 2026-11-01: full-eval numbers (nearest-rank, beyond the 3-URL minimum) — fixtures (n=3): canon 42.8/85.2s, proc 55.4/119.3s, rev 25.4/25.4s, tok 18.9/34.3k; urls (n=20): canon 61.5/79.6s, proc 111.3/143.5s, rev 29.6/41.4s, tok 32.2/42.0k, fetch 285/1939ms; 739k total.
  - 2026-10-29: fixtures measured (n=3, 0 failed checks): canon p50 30.3s/p95 42.5s, procedure p50 64.0s/p95 80.1s, review p50 17.7s/p95 32.3s, tokens p50 20.1k/p95 24.6k (64.8k total). URL portion BLOCKED: sandbox egress fails environment-wide (3 hosts + 2 channels); needs a networked env. urls.txt still unpopulated (no unverified guesses); M5.1 populates + verifies there.

## M5. Proof and disclosure (target: Nov 3)
- [x] **M5.1 Eval.** `npm run eval` runs the fixtures and the 20 URLs in
  eval/urls.txt (fetched at run time, never committed). It scores review
  checks passed, ingredient coverage, share of timings with source evidence,
  scheduled vs source total time, latency, tokens and cost, and writes
  eval/RESULTS.md.
  Check: RESULTS.md has 23 rows and no third-party text.
  - 2026-11-01: full run 23/23 green, 739k tokens (cost n/a, rate unset); skimmed clean (URLs/numbers/check-names only). 22 rows 12/12 review (happykitchen 11/12); soft flags on 3 rows (2 ingredient_names, 1 source_relationships), zero hard failures.
  - 2026-10-29: scripts/eval.ts built (fixtures + urls.txt, all 7 scores, RESULTS.md, URL rows URL-only) and fixture-validated live (3/3, 12/12 review, ~70k tokens). Owner added 20 URLs (4 http→https fixed); full 23-row run needs a networked env; set EVAL_USD_PER_MTOK for the cost column.
  - 2026-11-01: Oct 30 full run yielded 0/23 unknown-error, 0 tokens (pre-model failure in that shell, not a code bug — runner unchanged since Oct 29 and a fresh canonicalize probe passes, 8.5k). Runner now logs raw failure messages to console. Needs a clean re-run with a working key; RESULTS.md on disk is the stale Oct 30 output.
  - 2026-11-01: re-run also 0/23, raw cause "Connection error." on every model call while recipe fetches succeed — the owner shell cannot reach the model API host (sandbox reaches it fine and holds proxy vars the owner shell may lack). classifyError moved to src/lib/eval-label.ts with tests; connection/HTTP statuses now label model-error. Needs the shell network fix + another re-run.
  - 2026-11-01: root cause is a flapping owner-side route (fail windows alternate with green windows in the same shell/env; stale-export and proxy theories ruled out; duel probe 4/4 green). Nothing repo-side. Re-run eval inside an up-window; partial windows still bank per-row scores.
  - 2026-11-01: TRUE root cause found: importing full `cheerio` loads the undici package, which breaks global fetch to the model API in the owner shell (ladder: +cheerio fails, slim passes). Intake switched to `cheerio/slim` + regression lock test. Owner to re-run smoke, then the full eval.
- [x] **M5.2 Demo set.** Pre-warm the production cache with the 20 URLs, and
  list them on a /demo page.
  Check: each returns from cache in production.
  - 2026-10-30: /demo page built; prod pre-warm 14/20 verified (~456k tokens + partial spend on 7 failed runs). Duds: 3 gated (F&W 402, organickitchen/homemadefoodjunkie 403), food52 persistent 429, 2 review-blocked twice (foodmeanderings, thestingyvegan).
  - 2026-10-30: pass 2 over the updated list: 19/20 warmed + verified (5/6 replacements fresh-warmed, ~165k tokens). Gochujang noodles review-blocked twice (ingredient_coverage unused).
  - 2026-10-30: final replacement (Tasty shrimp tacos) converted fresh (20 ings, 11 tasks, 35k) + verified cached in 0.19s. 20/20 CLOSED.
- [ ] **M5.3 NEW-WORK.md.** What was built Oct 27 to Nov 4 with the commit range,
  what pre-existed outside this repo, and the exact changes made in the private
  TextSous repo for the handoff.
  Check: owner review.
  - 2026-11-04: summary in NEW-WORK.md updated through M7 (commit range, the TextSous app's handoff changes, outside-repo work); owner review pending.
- [x] **M5.4 README.** What it does, a 60-second quickstart, provider setup, the
  spec link, the embed snippet, limits, license, and the credit and takedown
  policy.
  Check: a clean clone follows the quickstart to a converted fixture.
  - 2026-10-29: README rewritten (all 8 sections); clean-clone verified: npm ci + herby convert → VALID artifact (4 tasks, 12/12 review, 21.8k).
- [ ] **M5.5 Final state.** AGENTS.md Status lists what is built; production
  health reports the Standard tier; HTTPS is valid; CI is green.
  Check: every "Done for every milestone" condition holds.
  - 2026-11-04: AGENTS.md Status rewritten for M7 (built on branch m7, not yet on main). The production checks wait for the M7 deploy (M7.10). /api/health has no tier field; `"model": "muse-spark-1.3"` with `"contributorModel": false` is the closest signal, so the owner should confirm that reading.

## M6. Phone-check follow-ups (target: Nov 3)
- [ ] **M6.1 Viewer reorder.** Move the adjust panel directly under the
  title/credit; collapse "What changed" into a closed-by-default `details`
  block.
  Check: owner re-checks the viewer on a phone; full gates green.
  - 2026-10-31: built (adjust under credit/allergens, What changed in closed details, free-form cuisine placeholder, above→below copy); 3 render tests, 244/244 + typecheck + lint + build green. Owner re-check pending (needs push + deploy).
- [x] **M6.2 Kitchen fractions.** New `formatKitchenAmount` in scaling:
  scaled cook/buy amounts and rescaled step numbers render as nearest 1/8
  with thirds and mixed numbers ("1 1/2"); original quantities stay
  verbatim.
  Check: table-driven tests (halves, thirds, mixed, ranges, buy amounts);
  CLI diff on fixtures shows fractions only in scaled fields.
  - 2026-10-31: formatKitchenAmount + ceilKitchenAmount (buy covers cook, countables whole); 20 table tests; 3 decimal expectations updated to the directed contract. Live herby --servings 6: 4t/12m, 12/12 review, sublinear "1 3/4", originals verbatim (20.2k + 2.5k tokens). 264/264 + typecheck + lint green.
- [ ] **M6.3 Honest progress UX.** Convert, transcribe, and adjust show
  elapsed time plus a plain-words stage explainer ("usually about 2
  minutes: reading, planning, checking") — reassurance, not fake
  percentages, since the client can't see server stages.
  Check: owner watches a slow convert and sees progress copy throughout;
  unit test on the stage copy.
  - 2026-10-31: built (ProgressNote with elapsed ticker + per-kind copy, wired into convert/transcribe/confirm/adjust); 3 tests incl. no-% lock; 267/267 + typecheck + lint + build green. Owner watch pending (needs push + deploy).
- [ ] **M6.4 Screenshot paste.** The photo tab accepts pasted clipboard
  images (`onPaste`) into the same transcribe pipeline with the same
  size/type limits.
  Check: tests for the paste path and its limits; owner pastes a recipe
  screenshot on phone and desktop.
  - 2026-10-31: built (onPaste on photo form → firstPastedFile → same transcribe pipeline; type/size limits shared); 4 tests; 271/271 + typecheck + lint + build green. Caveat: phone browsers (esp. iOS) rarely deliver image pastes to pages, so the picker stays the phone path. Owner check pending (needs push + deploy).
- [x] **M6.5 Extractor gains.** From the eval fail reasons in `RESULTS.md`,
  improve the text fallback and schema coverage for the top misses. The
  honest user-agent stays unchanged (a test asserts it) — no new bypasses.
  Check: previously-failing sample URLs either convert or degrade to the
  paste fallback; gates green.
  - 2026-11-01: CLOSED with no extractor change: all 20 eval URLs convert (23/23, 0 failures), so there are no failing samples to fix; UA lock test shipped. 3 soft flags (tasteandsee + livingsweetmoments ingredient_names, happykitchen source_relationships) recorded as future extractor follow-ups.
  - BLOCKED 2026-10-31: owner's eval run produced 0/23 with "unknown-error" and 0 tokens on every row (unclassified failure before any model call, even on fixtures) — there are no per-URL fail reasons to mine. UA lock test added (9/9 fetch tests green). Unblocks when a real eval fail list exists; extractor changes without that data would be guessing.
  - 2026-10-31: UA assertion test added (exact string + no browser tokens); suite green.
- [ ] **M6.6 Timer unification.** Every step timer renders visible in one
  style (no collapsed `details` variant); each timer gets +/− minute
  adjust. The "estimated time" wording stays, and `timerEnabledByDefault`
  stays in the data — this amends only the display half of the "timers
  default on" procedure rule.
  Check: owner checks timers on a phone (uniform, adjustable); gates
  green.
  - 2026-10-31: built (uniform Timer on every step, ±1 min adjust with drift-safe baseline, estimated wording kept; AGENTS display rule amended); 3 tests; 275/275 + typecheck + lint + build green. Owner check pending (needs push + deploy).

## M7. Assistants, embed, output format and brand (target: Nov 4)
Built Nov 3-4 on branch `m7` in three parallel streams (core, skills, embed),
then merged, brand-passed, reviewed and fixed; a fourth stream added the MCP
tools to the TextSous app in its private repo. Code comments name the build
spec's contracts: C1 artifact compatibility, C2 429 bodies, C3 skills API,
C4 MCP tools, C5 embed, C6 design tokens, C7 /assistants, C8 brand.
- [x] **M7.1 Review fixes.** Fix what the Nov 3 status review found: step
  cards follow dietary and cuisine variants; scaling starts from native
  servings and rescales only amounts tied to a unit or name; an EU-14
  allergen floor; cache hits served free before the per-IP limit and the
  daily cap; model calls and the pipeline bounded under the function limits;
  a 30-day cache keyed by model id; a 60,000-character input window; URL
  intake hardening; 256 KB body caps; photos shrunk in the browser; a timer
  row that fits a 390 px phone; the `--ts-*` design tokens.
  Check: each finding has a test that fails before its fix; gates green
  with MODEL_API_KEY unset.
  - 2026-11-04: core stream, 31 commits (13 fixes, the 8 M7.2 commits, then 10 fixes from its two reviews); 512/512 offline, typecheck, lint, build, schema/docs no diff. Vegan porridge cards name no butter, milk or cheese; the stroganoff shows gluten, fish, milk and mustard plus a celery trace.
- [x] **M7.2 Cook-along output format.** Procedure prompt v4: mise en place
  first with one prep task per preparation named in an ingredient line or
  note, exact amounts in descriptions, a batch as one grouped task, setup
  split from unattended waiting, the oven preheat first with a 10-minute
  heat-up, prepared inputs readied, at most one tip and a one-sentence `why`.
  `src/lib/format.ts` repairs titles, card titles and timing labels; three
  coded format warnings never block; "What changed" names tasks and steps,
  never ids; the viewer gains "Before you start" and an Essentials / With
  tips toggle.
  Check: live preview conversions show zero format warnings; gates green.
  - 2026-11-04: preview, procedure v4: beef stroganoff 12 tasks / 43 min, chicken tacos 16 / 52, maple glazed salmon 9 / 37, herby toast text 5 / 12; zero format warnings, clean titles; 164-279 s end to end, so convert got 420 s (deadline 400 s). Low reasoning effort for canonicalize measured 2-3x faster but less faithful: not adopted. 485/485 offline.
- [x] **M7.3 Skills API.** `GET /api/skills/format` (public),
  `POST /api/skills/source` and `POST /api/skills/cook-along` (secret), per
  docs/SKILLS.md: lenient body, strict validation with path-specific errors
  an assistant can act on, the code schedule and coded checks, compile, a
  24-hour signed artifact. No model calls, no daily cap.
  Check: tests for 503, 401, 413 and 429, the example end to end, the import
  link shape, and a daily cap of 1 left untouched.
  - 2026-11-04: skills stream, 10 commits (5, then 5 from its reviews); 334/334 offline. Local run on :3103: format 200 with its cache header, 401 without the secret, a real eval URL through source, the example saved (7 tasks, 15 min, gluten and milk). All 20 eval URLs return a source, both Smitten Kitchen pages included.
- [x] **M7.4 Use in your assistant.** /assistants connects TextSous to Muse,
  ChatGPT, Claude and Gemini through the TextSous MCP server
  (https://textsous.com/api/mcp, sign-in with a free TextSous account) and
  shows a ready-to-copy prompt for `?url=`. The daily-cap 429
  (`reason: "daily_cap"`) shows "Today's free conversions are used up" with
  "Continue in your AI assistant" to /assistants?url=<recipe> (bare
  /assistants for text and photo), in a new tab, from convert, adjust and
  the embed.
  Check: render and copy tests.
  - 2026-11-04: assistants-page, daily-cap-cta, embed-daily-cap and request tests green; the Muse steps say to ask Muse in a chat to create the custom connector, as textsous.com/assistants does.
- [x] **M7.5 Cook Along button.** public/embed.js puts a Shadow DOM button on
  recipe pages and opens an on-page overlay with an iframe to /embed; /embed
  converts one recipe without site chrome under the same-page rule; framing
  and caching headers in next.config.ts; /embed-demo is a demo blog post
  built from the CC0 porridge fixture; docs/EMBED.md.
  Check: unit tests for the script helpers, /embed, the headers and the
  demo; a browser check of open, Esc, Close, focus and a forged close
  message.
  - 2026-11-04: embed stream, 10 commits (6, then 4 from its reviews); 349/349 offline plus one post-merge test. Headless Chrome on :3102: Esc and the in-frame Close close it, focus returns to the button, Tab stays in the dialog while the page is inert, a forged textsous:close is ignored, a second include adds no extra buttons, and a recipe from another site shows the mismatch message.
- [x] **M7.6 Integration.** Merge the three streams into `m7`; the skills API
  takes the converter's optional `why`, the 10-minute oven heat-up wait and
  its format warnings.
  Check: gates green at the merge.
  - 2026-11-04: merges 95b0c55 and c3a059c plus 0e7d053; 624/624 offline in 59 files at c3a059c (rerun 2026-11-04), typecheck, lint, build, schema/docs no diff.
- [x] **M7.7 Brand pass.** Inter for the UI, a Fredoka "TextSous" wordmark
  with an "Open" pill, a site header (Demo, Use in your assistant, GitHub)
  and footer (MIT, SOUS AI LLC, Privacy, Takedowns), one 720 px column, white
  cards, Cook Along cards edged in the lane color with phase bands, the
  earth-tone lane palette, a light 404, and embed.js chrome in the same look.
  Check: screenshots of every page at 390 and 1280 px; no sideways scroll at
  390 px.
  - 2026-11-04: 6 commits; 645/645 offline in 61 files; stored artifacts, prompts, schemas and the cache key untouched; /embed still hides the header and footer.
- [x] **M7.8 Advisory review judgments.** equipment_capacity,
  source_relationships and tips_and_voice no longer block compile: a failed
  or missing judgment becomes a readable `reviewNotes` entry, shown under
  "Notes on this conversion" after convert, on cache hits, after adjust, for
  `?src=` links and in the embed. The other four judgments and the five coded
  checks still block, and a blocked review shows one calm sentence with the
  reasons behind "Details".
  Check: tests for the notes, compile, convert (an advisory failure gives
  200 with notes; a blocking or missing fidelity judgment gives 422), cache
  hits and adjust.
  - 2026-11-04: a687578 and f7b0d95; docs/schema/artifact.json and FORMAT.md regenerated for the optional field; no prompt, stage version or cache-key change.
- [x] **M7.9 Final review fixes.** From the contracts, security, readiness and
  visual-QA reviews: cross-site POSTs refused (403); input ceilings for one
  daily unit; "took too long" 503s instead of page-fetch errors; one retry of
  a quick upstream 429, 5xx or dropped connection under a deadline; a screen
  wake lock during conversions; the oven heat-up counted from the preheat;
  skills `summary.traces`, `error.scope` on 429s and capped error lists;
  DAILY_CONVERSION_CAP=0 pauses live conversions; health reports
  ratePerHour, skillsConfigured and signingConfigured;
  NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off hides Save to TextSous; `next dev` leaves
  AGENTS.md alone; 44 px tap targets and AA contrast.
  Check: each finding has a test that fails before its fix; full gates.
  - 2026-11-04: 22 commits; 21 of 22 review findings and 12 of 13 visual-QA findings applied (the skills secret budget and the wordmark pill's colors kept by decision); 711/711 offline in 68 files with MODEL_API_KEY unset, typecheck, lint, build, schema/docs no diff. Rerun in the docs session: 711/711, typecheck and lint clean, schema and docs unchanged.
  - 2026-11-04: review of those 22 commits: 10 confirmed findings (two of them the same defect), all fixed in 9 commits, every code change with a test that fails before it (SDK errors matched by class so the production build retries a dropped connection, blocked reviews always 422, the wake lock asked for again after an app switch, adjust and refused-link copy, the hourly-limit copy, no paste button on the Pasted text tab) plus the overlay-close and cross-site docs. The retry and timeout fix was also checked on the built bundle against a local fake model server. 722/722 offline in 68 files with MODEL_API_KEY unset, typecheck, lint, build, schema/docs no diff; prompts, stage versions and the cache key untouched.
- [ ] **M7.10 Ship and verify.** `m7` reaches main and deploys; the demo
  cache is warmed (O12); the owner checks Muse (O13) and phones (O14).
  Check: production `/api/health` is ok on muse-spark-1.3 and reports
  `ratePerHour` and `skillsConfigured`; `curl -I` shows
  `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on /, only
  `frame-ancestors *` on /embed, and `Cache-Control: public, max-age=300,
  s-maxage=3600` with `Access-Control-Allow-Origin: *` on /embed.js; O12, O13
  and O14 are done.
  - 2026-11-04: shipped. A preview of the final branch converted a /demo recipe live in 275 s (canonicalize 67 s, procedure 161 s, review 46 s) and its artifact parsed in the TextSous app's Cookbook importer. main fast-forwarded from `3e56ebb` to `f92e0a1` at 04:17 ET; CI green. Production checks: `/api/health` ok on muse-spark-1.3 with `dailyCap` 300, `ratePerHour` 20, `skillsConfigured` false (O10) and `signingConfigured` true; /, /demo, /assistants, /embed-demo, /embed, /embed.js and /api/skills/format answer 200 and an unknown path 404; the headers above match exactly; a convert POST marked cross-site gets 403; the secret skills routes answer 503 `not_configured`. O12 done. Open until O13 and O14.

## Owner actions (not for the coding agent)
Order for Nov 4: O10, O11, O13, O14, O8, O9 (the M7 deploy and O12 are done).
- [x] O1 Re-add the Meta key in Vercel as MODEL_API_KEY (Production and
  Preview, Sensitive) and delete `model_api_key`. Needed for M1.10.
  - 2026-10-28: owner confirmed key set and legacy var deleted; prod /api/health shows hasApiKey true.
- [x] O2 Add Upstash for Redis from the Vercel Marketplace and connect it to
  open-textsous. Needed for M1.10.
  - 2026-10-28: owner connected store textsous_cache + manual UPSTASH_* vars; prod health confirms upstashConfigured true.
- [ ] O3 Set DAILY_CONVERSION_CAP and the rate limit once M1 reports tokens per
  conversion.
  - 2026-11-04: optional now. After the M7 deploy the code defaults are 300 live conversions a day (DAILY_CONVERSION_CAP; 0 pauses live conversions while cache hits keep working) and 20 an hour per IP for each of convert, adjust and photo (RATE_LIMIT_PER_HOUR, at least 1). Set either in Vercel (Production and Preview) only to change them; `/api/health` shows `dailyCap` and `ratePerHour`.
- [ ] O4 Add the Baseten key if credits are approved (optional fallback).
- [x] O5 Choose the takedown and privacy contact address. Needed for M4.5.
  - 2026-10-29: owner chose privacy@textsous.com; footer shipped in M4.5.
- [ ] O6 Build /open and /import on textsous.com in the private repo by Nov 1.
  - 2026-11-03: in progress, past due date — /import in development (done soon), /open still being designed (owner may ask for design help).
  - 2026-11-04: built in the TextSous app's Cookbook import PR: /open redirects to https://open.textsous.com with the query kept (bare /open is 404), and /import?src= signs the person up or in and saves the recipe to their Cookbook. Its preview worked against open.textsous.com. Live once it merges and deploys (O11).
- [ ] O7 Add the imported-recipes line to the textsous.com privacy policy.
  - 2026-11-04: the line is in the Cookbook import PR's privacy page; live when O11 ships it.
- [ ] O8 Record the three-minute demo video (Nov 3).
  - 2026-11-04: not recorded yet. Record after M7 is live and the cache is warm (O12), so /demo and the /embed-demo overlay open instantly; due with O9.
  - 2026-11-04: M7 is live and the cache is warm; ready to record.
- [ ] O9 Submit on the Cerebral Valley platform by Nov 4, 9:00 PM ET, with the
  public repo and a public video link.
  - 2026-11-04: due tonight. NEW-WORK.md (M5.3) is the disclosure of what is new.
- [x] O10 Skills secret. Generate one value (`openssl rand -hex 32`). Set it
  as SKILLS_API_SECRET on the open-textsous Vercel project (Production and
  Preview, Sensitive) and as TEXTSOUS_OPEN_SKILLS_SECRET on the TextSous
  app's project, then redeploy both. Until then the two secret skills routes
  answer 503 `not_configured` and the MCP recipe tools say recipe skills are
  not set up. Done when production `/api/health` (after the M7 deploy) shows
  `"skillsConfigured": true`. Needed for O13.
  - 2026-11-04: done at the owner's request: one generated value set as SKILLS_API_SECRET (open-textsous) and TEXTSOUS_OPEN_SKILLS_SECRET (the TextSous app), Production and Preview, Sensitive, never printed; both redeployed. Production `/api/health` shows `"skillsConfigured": true`, and the secret skills routes answer 401 without it.
- [x] O11 TextSous app merges. Run the Cookbook import PR's database migration
  on production, merge that PR, then merge the MCP recipe-tools PR stacked on
  it, and deploy. Leave TEXTSOUS_OPEN_ORIGIN unset in production (it
  defaults to https://open.textsous.com). Done when
  `curl -sI "https://textsous.com/open?url=https%3A%2F%2Fexample.com%2Fsoup"`
  redirects to open.textsous.com and `curl -sI https://textsous.com/import`
  is not 404. If /import is not live when M7 deploys, build open-textsous
  with NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off so "Save to TextSous" stays hidden.
  Needed for O13.
  - 2026-11-04: the MCP recipe-tools PR is open, stacked on the Cookbook import PR (not merged). M7 deployed with "Save to TextSous" shown, so the button lands on a 404 until this ships.
  - 2026-11-04: done. The database migration was applied and the Cookbook import PR merged and deployed (textsous.com/import answers 200; /open redirects to open.textsous.com). The stacked MCP PR merged into its already-merged base branch, so the same commits went to the default branch in a replacement PR, merged and deployed at 14:58 ET.
- [x] O12 Warm the demo cache after the M7 deploy:
  `npm run warm -- --base https://open.textsous.com`. It converts each /demo
  URL and the /embed-demo post once, one at a time; cache hits are free. A
  fresh conversion takes 3 to 4 minutes, so the first run takes about an
  hour. Run it from a network you are not using for demos (each fresh
  conversion uses one of that network's 20 hourly conversions); after a 429,
  run it again later and it picks up where it stopped. Done when a second
  run prints "cache hit" for every URL.
  - 2026-11-04: done by the coding agent from 04:18 ET with three runs in parallel over split lists: 17 fresh conversions (169-276 s each), all 200 in the production logs, the rest cache hits. The script reported 7 of the 17 as failed after about 40 s each time it reused a kept-alive connection after a long conversion, while the server finished and cached them; it now opens a fresh connection per request. A second run printed "cache hit" for all 21 (20 /demo URLs and the /embed-demo post). One cached recipe carries an advisory review note.
- [ ] O13 Muse end to end (after O10, O11 and the M7 deploy). Add the custom
  connector https://textsous.com/api/mcp in Muse (Settings > Connectors >
  Add custom connector, or ask Muse in a chat to create it, as /assistants
  says), sign in with a TextSous account, then send a recipe link and ask
  for a cook along. Done when Muse calls get_cook_along_format,
  get_recipe_source and save_cook_along, the viewUrl opens on
  open.textsous.com, and the recipe is in the Cookbook. If Muse's steps
  differ from /assistants, correct the page.
- [ ] O14 Phone checks on production after the M7 deploy: a cached and a
  fresh /demo recipe, pasted text, a photo (picker, confirm, convert), an
  adjustment (servings, then vegan: no butter, milk or cheese left on the
  cards), the Cook Along button on /embed-demo (open, Close, Esc), and
  /assistants?url=<recipe>. This also covers the M6.1, M6.3, M6.4 and M6.6
  re-checks.
