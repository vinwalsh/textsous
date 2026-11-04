# NEW-WORK.md — hackathon build log (Oct 27 – Nov 4, 2026)

## Hackathon build summary (M5.3; finalize Nov 4)
Everything in this repo was built inside the window, starting from
`960fe7a` (Initial, Oct 27): 22 commits on main through `3e56ebb` (Nov 3),
then M7 on branch `m7`: 82 commits from `295620c` through `484750a` (Nov 3,
22:50 ET to Nov 4, 02:06 ET; two of them are merges) plus the M7 docs
commit. The range extends if further commits land before the Nov 4, 9:00 PM
ET deadline. M1 foundation + first conversion (Oct 27–28), M2 Cook Along
pipeline (Oct 28), M3 adjustments (Oct 29), M4 photo, web flow and artifact
handoff (Oct 29–31), M5 proof and disclosure (Oct 29–Nov 3), M6 phone-check
follow-ups (Nov 1), M7 assistants, embed, output format and brand (Nov 3–4).
Detail is in the dated log below. Proof through M6: 287 offline tests
green, CI green, production `/api/health` ok on muse-spark-1.3, full eval
23/23 (739k tokens). Proof for M7: 711 offline tests in 68 files with
MODEL_API_KEY unset, typecheck, lint, build and the schema/docs gate on
`m7`, and four live conversions on a Vercel preview of the core stream;
production checks follow the deploy (TASKS.md M7.10).

Pre-existing outside this repo: the private TextSous platform (accounts,
households, weekly meal plans, grocery lists, SOUS over text and MCP — with
no public recipe import); Vercel project `open-textsous` with
open.textsous.com attached; Upstash store `textsous_cache`; Meta Model API
access (muse-spark-1.3) and a Baseten account. (Other accounts, prior
prototypes, and shared design assets are disclosed separately by the
owner.) No recipe format, converter, or handoff code existed anywhere
before Oct 27.

Private-repo handoff changes (the TextSous app; its code stays private).
Neither change is merged or deployed yet (TASKS.md O11):
- Cookbook import PR (O6, Nov 3): a Cookbook in the TextSous app where
  imported recipes live and can be added to the week's plan;
  `textsous.com/open?url=` (or `?src=`) redirects to https://open.textsous.com
  with the query kept, and bare `/open` is 404; `textsous.com/import?src=`
  accepts only a signed artifact link of the shape
  `<origin>/api/artifact/<uuid>?sig=<64 hex>` from allowed origins, signs the
  person up or in, and saves the recipe to their Cookbook; the privacy
  policy gains the imported-recipes line (O7).
- MCP recipe tools (Nov 3–4, stacked on the Cookbook PR): `get_cook_along_format`
  (read), `get_recipe_source` (read) and `save_cook_along` (write, saves to
  the Cookbook) on the existing MCP server at https://textsous.com/api/mcp.
  They call this repo's skills API with a shared secret and an opaque hashed
  account key; two env vars (the open site's origin and the secret),
  per-person limits, and a privacy-policy note about the hashed key.

Outside-repo hackathon work besides the TextSous app changes above: none
(per owner, Nov 3).

Clock note: dated entries from Oct 31 to Nov 2 were written under a stale
session clock and run up to two days behind their commit dates; the commit
dates above govern. Every entry falls inside the window regardless.

2026-10-27: Scaffolded the repo as a Next.js 16 app (App Router, TS, ESM, Node 22) and built slice 1: canonical schema + response_format helper, model client (meta/baseten, json_schema with JSON-mode fallback, 2 validation re-prompts), URL intake (SSRF guards, JSON-LD incl. @graph/HowToSection, text fallback) + text intake, canonicalize stage with deterministic checks, CLI (convert/smoke), placeholder home + /api/health + /api/convert (rate limit, daily cap, Upstash/filesystem cache), 3 original CC0 fixtures, 18 offline tests; `npm test`, `typecheck`, `lint`, `next build` green, `docs/schema/canonical.json` generated; live convert runs still need MODEL_API_KEY.

2026-10-27: Verified Vercel access (vinwalsh, open-textsous) and ran slice 1 live: smoke ok on meta (330 tokens), baseten 404 as expected without its endpoint; convert passed all checks on all 3 fixtures first attempt (5.2k–6.9k tokens each, completion-heavy). Fixed model client to pass fetch: globalThis.fetch (SDK default bypasses proxy env). Model notes: kept [Apples] extractor prefixes in step text, left equipment empty despite named pans, split salt/pepper into two to-taste lines.

2026-10-27: Fixed live-run warts: strip injected [Section] labels from canonical step text (prompt rule + deterministic code strip of known labels, 2 new offline tests), strengthened equipment prompt (now captures saucepan/skillet/bowls, grill/bowl, fork); salt/pepper split diagnosed as acceptable run-varying judgment (7 vs 8 ingredients across runs, checks pass either way). Re-ran all 3 fixtures live: all checks pass first attempt (5.0k–6.0k tokens each); 2 transient connection errors recovered on retry.

2026-10-27: Wired BASETEN_BASE_URL / BASETEN_API_KEY for the baseten provider profile (fallback to MODEL_*, fixed model id), added /api/health baseten presence flags and offline provider-resolution tests (22/22 green); baseten smoke still 404s cleanly until real Baseten values are set.

2026-10-27: Baseten live: smoke ok on meta-models/muse-spark-open-1026 (198 tokens, json_schema accepted); full porridge convert passed all checks first attempt (10,708 tokens, completion-heavy vs ~6k on meta). Quality matches meta except "apple, diced" kept prep in the name. No code changes; this log line is uncommitted.

2026-10-28: Verified M1 against TASKS.md: closed M1.1/M1.3/M1.8/M1.9 (build green key-unset; 22/22 tests; smoke 314 tokens; 3 fixtures convert first-try, schema-valid, 18.0k tokens total); M1.2/M1.10 blocked (push needs GitHub auth so CI never ran; prod health needs O1/O2); M1.4-M1.7 open (missing fake-transport, fetch-guard, fixture-text and recorded-response tests). Push attempted, auth failed. No code changes; probes removed.

2026-10-28: Owner pushed (origin/main at f625d43), CI green so M1.2 closed; O1 done (MODEL_API_KEY in Vercel, legacy var deleted, prod hasApiKey true); applied TASKS.md wording fixes (M1.1 Node 22, health `"status":"ok"` + implemented flags). Prod /api/health live but upstashConfigured false, O2 env pending. No code changes.

2026-10-28: O2 done (Upstash store textsous_cache connected; namespaced KV_* vars copied to manual UPSTASH_* vars for Production/Preview); prod /api/health fully green so M1.10 closed. M1 remaining: M1.4-M1.7 test gaps only. No code changes.

2026-10-28: Closed M1.4-M1.7: injectable model-client seam + 5 fake-transport tests; 8 offline fetch-guard tests; herby fixture-text test; --record flag + rawResponse passthrough + 3 recordings + 1 doctored with 4 replay tests. 40/40 green key-unset, typecheck + lint clean. Live record runs: 6580/4245/7216 tokens, all checks pass first try (herby 8 ingredients this run, salt/pepper split). All 10 M1 items closed; needs push for CI + prod re-verify.

2026-10-28: M2.1 done: timeline + artifact zod schemas (closed enums, nullish optionals, min(1) sourceStepIds), docs/schema/timeline.json + artifact.json generated (canonical.json byte-identical); 4 schema tests incl. deep strictness, 44/44 green key-unset, typecheck + lint clean. No live calls.

2026-10-28: M2.2 done: procedure stage (lanes/phases/hands-on split/sourced timings/holds, 24k cap) + runProcedureChecks (step ids, quotes, references, lanes, timers) + CLI procedure cmd with --record; 6 check unit tests + 3 recording replays. Live: porridge 6 tasks/13.5k, corn 5/13.8k, herby 4/13.0k tokens, all checks pass first try. 54/54 green. Added nullable sourceQuote to the timeline schema (docs regen'd).

2026-10-28: M2.3 done: deterministic scheduler (Kahn topo order, one-cook hands-on serialization, holds union, prep-first, serve-last, CPM critical path); 10 known-answer tests; fixture timelines schedule cleanly (porridge 14m, corn 16m, herby 12m). 64/64 green, no live calls.

2026-10-28: M2.4 done: review stage (5 coded checks incl. full schedule verification, 7 model judgments in one call, blockers gate compile); 14 tests (pass/fail per coded check + mapping). Live review passes 3/3 fixtures (5.3k/3.8k/4.3k tokens). Live validation caught a real bug: dual-channel holds double-counted as self-overlap, fixed + regression test. 78/78 green.

2026-10-28: M2.5 done: compile stage (credit copy, definite-presence allergen roll-up, keyword method derivation, merged-steps/estimate changes, throws on failed review); 7 tests; 3/3 fixture artifacts VALID (methods Toasted/Grilled/Toasted, roll-ups correct). 85/85 green, no live calls.

2026-10-28: M2.6 done (M2 complete): convertToArtifact pipeline, convert writes full artifact + --timeline Gantt + per-call tokens, /api/convert returns artifact with v2 cache (all stage versions) + 422 on compile-blocked; gantt + api route tests. Live: 3/3 artifacts VALID, 0 failed checks (porridge 8t/17m/24.4k, corn 5t/16m/17.3k, herby 4t/12m/22.2k). 91/91 green.

2026-10-29: M3.1 done: amounts parser (fractions/mixed/ranges/vulgar) + unit table + number extractors; 44 table-driven tests.
2026-10-29: M3.2 done: scaleIngredient cook/buy under 5 rule curves + assignScaleRules + applyScaling (0.5-12 bounds, step rescale + flags); 17 tests.
2026-10-29: M3.3 done: dietary stage + shared variant applier (swaps/omits, timing + reintroduction guards, method notice); live all 7 targets on porridge, restricted absent (19.2k tokens).
2026-10-29: M3.4 done: voice stage (per-field numeric guard, selective retry, keep-original fallback); 6 offline tests.
2026-10-29: M3.5 done: cuisine stage (third-budget enforcement + shared guards); live gf→Italian clean, no gluten back (8.3k tokens).
2026-10-29: M3.6 done (M3 complete): adjustArtifact fixed-order composition + convert flags + /api/adjust; live 4-flag runs VALID (porridge 43.0k, corn 31.0k). 180/180 green. Schema note: new variant.json, cookQuantity/buyQuantity, scale/swap/technique change kinds.
2026-10-29: M4.1 done: photo intake (magic-byte PNG/JPEG/WebP + 5 MB + EXIF orientation, vision transcribe, canonicalize with photo source, POST /api/photo); messages now per-role types (images only on user, compiler-checked); 18 tests incl. no-bytes-stored. Live herby PNG: 7/7 ingredients, 4/4 steps, credit captured (10.4k tokens). 198/198 green.
2026-10-29: M4.2 UI built (owner phone check pending): intake tabs (URL/text/photo, ?url= auto-convert, ?src= load), photo confirm, viewer (credit, allergens, method notice, ingredients, checkable mise en place, lane timeline, steps with cues + timers, changes), adjust panel (servings/dietary/cuisine/SOUS voice + what-changed + reset); /api/convert {recipe} via convertRecipeToArtifact. Gates green (200/200 + build); live recipe-path VALID, 0 failed (13.2k); render smoke 17/17. Save button arrives in M4.3.
2026-10-29: M4.3 done: artifact store (random UUID, HMAC-SHA256 over id+expiry, constant-time verify, Upstash native TTL / filesystem dev, 404 expired / 403 tampered, multi-fetch) + POST /api/artifact + GET /api/artifact/[id] + handoff URL builders + viewer "Save to TextSous" button to textsous.com/import?src=. 14 tests; 214/214 green + build.
2026-10-29: M4.4 done: docs/FORMAT.md generated from the 4 zod schemas via npm run docs (173 field lines, enums/constraints/nullability inline, byte-identical reruns) + hand-written docs/EMBED.md ("Open with TextSous" snippet, utm_source=open-textsous, utm_medium=embed) + CI diff gate. Schema JSONs verified current; 214/214 green.
2026-10-29: M4.5 done: friendly error copy per path (refused URLs, timeouts, 429 cap/rate, 422s, 500/502) + ErrorBox + apiFetch 150s timeout, wired into convert/photo/confirm/adjust/save; redacting logEvent (URLs + data URLs) in convert/adjust/photo routes; footer with privacy@textsous.com (O5) + privacy note. Health already covered provider + cache. 26 tests (240/240) + build.
2026-10-29: M4.6 partial (fixtures only, n=3, nearest-rank): canon 27.2/30.3/42.5s, procedure 57.4/64.0/80.1s, review 16.2/17.7/32.3s (min/p50/p95); tokens 20.1k/20.1k/24.6k per conversion, 64.8k total; 0 failed checks. URL portion blocked: no external fetch from this sandbox (confirmed env-wide); urls.txt left empty for M5.1 to populate in a networked env. No product change; 240/240 still green.
2026-10-29: M5.4 done: README rewritten (what/quickstart/providers/spec/embed/limits/license/credit+takedown); clean-clone check passed (npm ci + herby fixture → VALID 4-task artifact, 12/12 review, 21.8k).
2026-10-29: M5.1 runner built (scripts/eval.ts + npm run eval): fixtures + urls.txt with per-stage timing, all 7 scores, RESULTS.md writer with URL-only rows; fixture-validated live, 3/3 at 12/12 review (~70k). Full run + urls.txt need a networked env.
2026-10-29: eval/urls.txt populated with 20 recipe URLs (owner; 4 http→https fixed at commit) alongside the M5.4 README + M5.1 runner commit.
2026-10-30: paste-text fallback for failed URLs: refused-address, roundup and unreachable errors now offer "Paste the recipe text instead" (jumps to the text tab); ErrorBox action support. 240/240 green + build.
2026-10-30: M5.2 pre-warm pass 1+retry: 14/20 prod URLs warmed + verified (~456k tokens); 3 bot-gated, food52 429 persisting, 2 review-blocked twice. /demo page built, uncommitted. Needs 6 owner replacement URLs + pass 2.
2026-10-30: M5.2 pass 2: 19/20 verified on the updated list (5/6 replacements fresh-warmed, ~165k). Gochujang noodles fails review twice (ingredient_coverage unused, same signature as foodmeanderings) — 1 replacement to go.
2026-10-30: M5.2 done: final Tasty replacement converted fresh (20 ingredients, 11 tasks, 35k) + cache-verified in 0.19s. 20/20 demo URLs return from cache in production.
2026-10-31: M4.2 phone-check fix: removed capture="environment" from the photo file input (it forced the camera on mobile with no Library/Browse choice) + optional initialTab seam with a render regression test. 241/241 green + typecheck + lint. Uncommitted; ship with the demo commit so the owner re-checks both on prod.
2026-10-31: M4.2 closed: owner phone pass on prod verified every path (fresh + cached URL, /demo, text, photo, viewer attribution, vegetarian + cuisine adjust, ?src=); picker fix + graceful-failure re-checks pass on the fresh deploy, which also verified the push.
2026-10-31: M6.1 built: adjust panel moved under title/credit (allergens stay above it), What changed collapsed in details, cuisine placeholder reworded to a free-form example. 3 render tests; 244/244 + typecheck + lint + build green. Owner phone re-check pending deploy.
2026-10-31: M6.2 done: kitchen fractions for scaled amounts (nearest 1/8 + thirds + mixed; buy rounds up on-grid, countables whole; ties down; tiny→1/8). 20 table tests; live herby 2→6 servings VALID with "1 3/4" sublinears, originals verbatim (22.7k tokens). 264/264 green.
2026-10-31: M6.3 built: honest progress UX (elapsed ticker + approximate stage copy, no fake percentages) on convert, transcribe, photo-confirm and adjust. 3 tests; 267/267 + typecheck + lint + build green. Owner watch pending deploy.
2026-10-31: M6.4 built: screenshot paste on the photo tab (form-level onPaste, shared PNG/JPEG/WebP + 5 MB limits, hint copy). 4 tests; 271/271 + typecheck + lint + build green. Owner paste check pending deploy; picker stays the phone path.
2026-10-31: M6.5 blocked: eval run shows 0/23 unknown-error with 0 tokens (systematic pre-model failure, not per-URL misses) — no fail reasons to mine. Shipped the required UA lock test only (exact string + no browser tokens); extractor work waits for a real fail list.
2026-10-31: M6.6 built: uniform visible timers on every step with ±1 min adjust (timestamp baseline survives adjust-while-running; clamps at 0); estimated wording kept, AGENTS display rule amended. 3 tests; 275/275 + typecheck + lint + build green. Owner check pending deploy.
2026-11-01: Eval failure diagnosed: Oct 30 run went 0/23 unknown-error with 0 tokens — a model-API-side failure in that shell (auth/quota/rate/outage), not the code (runner untouched since Oct 29; fresh probe green, 8.5k). scripts/eval.ts now prints raw failure messages to console; re-run needed. M6 batch + runner fix committed (039384d, fca94ce), push left to owner (sandbox has no git auth).
2026-11-01: Eval re-run also 0/23 — raw cause "Connection error." on model calls, recipe fetches fine: the owner shell can't reach the model API host. Moved classifyError to src/lib/eval-label.ts with 11 tests; connection/HTTP failures now label model-error. 286/286 green. Owner shell network fix + re-run still needed.
2026-11-01: Eval connectivity root-caused to a flapping owner-side route to the model hosts (same shell/env alternates fail/green; stale exports, proxies, TLS, code all ruled out via duel probe, 4/4 green in an up-window). Fix is running the eval inside an up-window; per-row catches bank partial progress.
2026-11-01: TRUE eval root cause: full-cheerio import loads undici@7, breaking model fetch in the owner shell (import ladder proved it). Switched intake to cheerio/slim (we only use load()) + regression lock test. 287/287 + typecheck + lint + build green. Owner smoke + full eval re-run next.
2026-11-01: M5.1 done: full eval 23/23 green, 739k tokens, skimmed clean (M4.6 numbers computed from the same run; M6.5 closed with no misses to fix, UA lock shipped). Awaiting commit of RESULTS.md + closures.

2026-11-04: M7 began at 22:50 ET on Nov 3 as three parallel streams branched from `3e56ebb`: core (review fixes and the output format), skills (skills API and /assistants) and embed (the Cook Along button), plus a fourth stream for the MCP tools in the TextSous app's private repo. Each stream was reviewed twice and fixed, then merged into `m7`, brand-passed, reviewed again (contracts, security, readiness, visual QA) and fixed. 82 commits through `484750a` at 02:06 ET.

2026-11-04: Step cards follow dietary and cuisine variants: an optional `taskOverrides` list in the variant transform (dietary and cuisine stage v2), and code rewording with a warning when the model sends none. Removing an ingredient takes its amount and prep words with it and never leaves a hanging clause; a card left with nothing to do is dropped (its dependents take over its dependencies) or, when dropping is unsafe, becomes a "Skip this step" card with its timer off. Vegan porridge leaves no butter, milk or cheese in task text.

2026-11-04: Scaling always starts from native servings (new optional `recipe.nativeServings`, scaling stage v2), so 2→4→6 equals 2→6, and dietary and cuisine prompts see the current scaled amounts. Numbers in step and card text change only when an ingredient's unit or name follows (up to two describing words; a parenthetical package size is skipped; "2 c flour" reads as cups); times, temperatures and pan sizes never change. Card numbers that can't be matched are flagged by card label in What changed, and scale flags name steps by position, never by id.

2026-11-04: Deterministic EU-14 allergen floor (src/lib/allergens.ts) in canonicalize, compile, variants, cache hits and the viewer. It only adds tags; an alternative in a note ("or vegan butter") adds at most a trace, and a substitute's "Replaces …" note never passes on the old ingredient's allergens. The viewer says "Contains: … May contain: … This list can miss things. Check every label."

2026-11-04: Limits: cache hits are free and served before the per-IP limit and the daily cap; a daily unit is reserved just before live model work and given back when no model tokens were spent (an adjust request with no adjustment is now a 400 and uses nothing). DAILY_CONVERSION_CAP defaults to 300 and RATE_LIMIT_PER_HOUR to 20; 429 bodies are `{ error, reason: "daily_cap" | "rate_limited" }`.

2026-11-04: Timeouts: convert maxDuration 420 s with a 400 s deadline counted from the request start (page fetch included); adjust and photo 300 s with a 280 s deadline; artifact routes 30 s. A stage starts only with enough time left, the SDK retries only when a second attempt still fits, a reply cut off at the length limit is retried once with a request for a shorter answer, and a deadline stop is a friendly 503. The browser waits 430 s, and the convert progress copy says "Usually 3 to 4 minutes".

2026-11-04: Cache and input: conversions stay cached 30 days under key `textsous:convert:v3`, which includes MODEL_ID (old-key entries carried over for the default model). Canonicalize reads up to 60,000 characters: longer pasted text is refused with a clear message, and page text is cut at 60,000 with a warning, also when the JSON-LD has no ingredient lines.

2026-11-04: Hardening: the URL intake's 10 s timer covers the whole body read; the credit URL is an https same-host canonical or the final URL; 100.64/10, 198.18/15, 64:ff9b::/96, IPv6 literals and non-default ports are refused. JSON bodies over 256 KB get 413 on convert, adjust and artifact, with their own message instead of the photo-size one. The browser shrinks photos (2048 px long edge, JPEG 0.85, under 3.5 MB) before upload. Every failure response logs route, status, error class and code (redacted) as request_failed. scripts/eval.ts refuses contributor-tier models on URLs, and isContributorModel ignores case.

2026-11-04: Viewer and docs: convert warnings show under "Notes on this conversion" above Before you start; the step timer row fits a 390 px phone; the `--ts-*` design tokens sit in globals.css; docs/schema lists nullish fields as optional and FORMAT.md marks them, while the strict model-facing schema is unchanged.

2026-11-04: Cook-along output format (canonicalize 2, procedure 4, review 2, compile 2): mise en place first with one prep task per preparation named in an ingredient line or note (ingredient notes now reach the model), exact amounts in every description, a batch as one grouped task (rounds x per-round time, an estimate with a range), setup split from unattended waiting, the oven preheat as the first prep task with a 10-minute heat-up, prepared inputs readied in their lane, the source's time phrase kept and quoted, at most one tip and a one-sentence `why` (new optional task field).

2026-11-04: Deterministic post-processing (src/lib/format.ts): title cleanup ("Recipe", site names, emoji, marketing tags), card titles without amounts, times or temperatures, timing-label repair and promotion of repeated source time phrases, one-sentence why, natural casing for free-text amounts. Coded, non-blocking format warnings (prep_not_covered, amount_missing, batch_round_timing) in review, the pipeline, /api/convert (`formatWarnings`, plus per-stage timings) and the CLI. "What changed" notes name tasks and steps, never ids.

2026-11-04: Viewer: a "Before you start" block (about N min to serve, M min hands-on, one cook; components in their lane colors; equipment) and an Essentials / With tips toggle remembered in localStorage.

2026-11-04: Live preview check at procedure v4: beef stroganoff, chicken tacos, maple glazed salmon and the herby toast text gave 12/16/9/5 tasks, 4/6/3/2 prep tasks and 43/52/37/12 min total, with zero format warnings and clean titles, 164-279 s end to end. Low reasoning_effort for canonicalize was 2-3x faster on half the tokens but less faithful (split "salt and pepper", lost "to taste"), so it stays unset.

2026-11-04: scripts/warm-demo.ts (`npm run warm -- --base <origin>`) converts each /demo URL once through a deployed /api/convert, one at a time, with cache hits free; the /demo copy no longer promises pre-warmed recipes.

2026-11-04: Skills API for assistant-authored cook alongs (docs/SKILLS.md): GET /api/skills/format (public: instructions, inline JSON Schema and an example built from the CC0 porridge fixture), POST /api/skills/source and POST /api/skills/cook-along (secret: SKILLS_API_SECRET as a bearer token). Lenient input with server defaults, strict validation with field-specific fixable errors, the code schedule and coded checks, compile, and a 24-hour signed artifact in the "Save to TextSous" store. No model calls and no daily cap; 600 requests an hour per secret and 60 per X-TextSous-Account, the account limit checked first.

2026-11-04: Skills review fixes: the source route accepts blog recipe cards without JSON-LD (three or more measured amounts), so all 20 eval URLs return a source; serveTaskId, unknown-dependency and default-id errors name the field and list the ids that exist; the guide spells out the `task-<slug>` id rule.

2026-11-04: /assistants: connect TextSous to Muse, ChatGPT, Claude and Gemini through https://textsous.com/api/mcp with a free TextSous account, plus a ready-to-copy prompt for `?url=`. The daily-cap error says "Today's free conversions are used up" and links to /assistants?url=<recipe> in a new tab, using the 429 `reason` or "Daily" in the message.

2026-11-04: Cook Along button for recipe sites: public/embed.js puts a Shadow DOM button on any page and opens an on-page overlay with an iframe to /embed. It supports several placements, data-recipe-url, data-src (pre-converted CLI artifacts, fetched by the host page), data-label and data-autoopen, and a placement's own attributes win. It closes from its button, Esc, the backdrop or an origin-checked textsous:close (the https twin of an http script origin is trusted), keeps focus inside while the page is inert, restores focus, locks scrolling and is safe to include twice.

2026-11-04: /embed shows the converter and Cook Along viewer for one recipe without site chrome (header and footer hidden). It converts only recipes on the embedding site (same-page rule, ignoring www.) and loads ?src= artifacts; Save to TextSous and every link open in a new tab; Close posts textsous:close; the daily-cap error links to /assistants?url=<recipe>.

2026-11-04: Framing and caching headers: /embed may be framed by any site (frame-ancestors *); every other route allows same-origin framing only (frame-ancestors 'self' + X-Frame-Options SAMEORIGIN); /embed.js is cached 5 min (1 h at the CDN) with ACAO *. A unit test checks headers() with Next's route matcher.

2026-11-04: /embed-demo is a recipe blog post labeled as a demo, using the CC0 porridge fixture with schema.org Recipe JSON-LD and the embed snippet; away from production it explains how to test with `?src=…&autoopen=1`. docs/EMBED.md is rewritten for the script: attributes, overlay, same-page rule, privacy, caching, data-src pre-conversion, and the plain-link no-JS fallback that leaves the page.

2026-11-04: Integration on `m7`: merged skills (95b0c55; url.ts keeps core's warnings and skills' jsonLd) and embed (c3a059c; ArtifactViewer keeps core's notices and tips toggle with embed's embedded/onClose props). The skills API took the converter's optional `why` and the 10-minute oven heat-up wait, and returns its format warnings (0e7d053). 624/624 offline at c3a059c.

2026-11-04: Brand pass: Inter for the UI and a Fredoka "TextSous" wordmark with an "Open" pill; a site header (Demo, Use in your assistant, GitHub, one line of intro) and footer ("Open source (MIT) by SOUS AI LLC · Privacy · Takedowns" plus the privacy note); one 720 px column on --ts-bg; white cards, 11 px uppercase labels, 8 px-radius buttons, a 2 px focus ring and pill toggles; Cook Along cards with a 3 px lane-color edge, unattended cards in a pale green, and Prep/Cook/Finish phase bands; the earth-tone lane palette (src/lib/lane-palette.ts) for new lanes and, by position, in the viewer; a light 404; embed.js chrome in the same fonts and colors. 645/645 offline.

2026-11-04: Advisory review judgments: equipment_capacity, source_relationships and tips_and_voice never block compile. A failed or missing judgment becomes a readable note (src/lib/review-notes.ts swaps ids for names) in the new optional artifact field `reviewNotes`, appended to the warnings and shown under "Notes on this conversion" after convert, on cache hits, after adjust, for ?src= links and in the embed; the CLI prints ADVISORY lines. source_fidelity, quantities, dietary_conditions, method_and_safety and the five coded checks still block, and a blocked review now reads "We couldn't double-check this one" with the reasons behind Details.

2026-11-04: Final review fixes (contracts, security, readiness): convert, adjust, photo and artifact POSTs a browser marks cross-site get 403 before any limit; adjust refuses an artifact over 64 KB or a cuisine over 80 characters, and convert a `{recipe}` over 60,000 characters. A model-call timeout is a 503 "took too long" (MODEL_CALL_TIMEOUT_MS 300 s, each call still bounded by the route deadline), and a deadline stop on convert is a 503, not a 400. Under a deadline, an upstream 429, 5xx or dropped connection is retried once after 1.5 s when time is left. The oven heat-up counts from the preheat (readyAfter, shared by the scheduler, the critical path and the review). A screen wake lock holds during convert, photo, adjust and the embed, and a dropped request explains itself. Photo progress says 1 to 2 minutes.

2026-11-04: Final review fixes (skills, limits, ops): the skills summary lists `traces`; skills 429s carry `error.scope` (account or service); save errors are capped at 50 with at most 20 ids each; format advice names each missing amount and prep task once. DAILY_CONVERSION_CAP=0 pauses live conversions (cache hits still work); /api/health adds ratePerHour, skillsConfigured and signingConfigured (booleans, never values). The warm script also warms /embed-demo and waits for slow conversions. NEXT_PUBLIC_SAVE_TO_TEXTSOUS=off hides Save to TextSous; next.config.ts sets agentRules: false so `next dev` leaves AGENTS.md alone; /assistants tells people to add TextSous to Muse from a chat; the embed iframe may keep the screen on.

2026-11-04: Visual QA at 390 and 1280 px: AA contrast on unattended cards, the /assistants prompt card and form borders; 44 px tap targets for tabs, toggles, timers, check rows, header links, the file picker and the overlay's Close; lane names wrap; the cuisine placeholder reads "e.g. Italian"; next to the daily-cap button the submit buttons turn secondary; the footer shows the takedown address; the /embed-demo snippet wraps. 711/711 offline in 68 files, typecheck, lint, build, schema/docs gate green.

2026-11-04: TextSous app, private repo, not merged: three MCP tools on the existing server at https://textsous.com/api/mcp. get_cook_along_format (read; the open site's format, cached 10 minutes), get_recipe_source (read; refusals come back as data) and save_cook_along (write; the open site builds the cook along, then it is filed in the person's Cookbook; returns viewUrl, cookbookUrl, summary, warnings and expiresAt; 422 errors come back as data). Its input is never stricter than the skills API's, its per-person limits fit inside the open site's 60 an hour per account, and the open site gets an opaque hashed account key, never the user id.

2026-11-04: Docs for M7: AGENTS.md (Status, Layout, skills and embed rules, advisory checks), TASKS.md (M7 and owner actions O10-O14), README.md (Cook Along button, AI assistants, self-hosting), HANDOFF.md (the TextSous app contract) and this log.
