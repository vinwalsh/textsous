# NEW-WORK.md — hackathon build log (Oct 27 – Nov 4, 2026)

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
