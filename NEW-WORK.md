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
