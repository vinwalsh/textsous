# Handoff: TextSous Open converter

For the next agent picking up this repo. Last updated: 2026-10-30.

## Where things stand

- **M1–M3** closed, pushed, deployed.
- **M4** complete: all items closed (M4.6 full-eval numbers
  2026-11-01, beyond the 3-URL minimum).
- **M5**: M5.1 (eval 23/23), M5.2 (demo pre-warm), M5.4 (README)
  closed. M5.3/M5.5 pending (see below).
- Suite: 275/275 offline green (`MODEL_API_KEY` unset). M6.1 + M6.3 +
  M6.4 + M6.6 built (owner re-checks pending one push + deploy), M6.2
  closed, M6.5 blocked (eval 0/23 unknown-error, 0 tokens — owner's run
  needs a working model setup before it yields fail reasons). Prod
  (open.textsous.com) deploys `main` on push. Owner pushed 2026-10-31:
  origin/main has the demo page + photo-picker fix, /demo verified 200.
  M4.2 re-checks remaining: photo Library choice, Allrecipes paste
  fallback.
- Source of truth for status is TASKS.md; NEW-WORK.md is the dated work log;
  AGENTS.md holds the repo rules. README.md is user-facing.

## Open loops

- M5.1 full eval: DONE 23/23 (739k tokens, skimmed clean) after the
  cheerio/slim fix. Say the word to commit `eval/RESULTS.md` + closure
  docs (TASKS/NEW-WORK/HANDOFF edits uncommitted).
- M5.3: final NEW-WORK summary once the commit range is settled, plus the
  owner's private-repo handoff notes (not visible from here).
- M5.5: needs a push/deploy; also unresolved: the item says health "reports
  the Standard tier" but `/api/health` has no tier field — ask the owner
  what that check wants before closing.
- Owner items still open: O3 cap sizing (~20–25k tokens/conversion
  measured), O4 Baseten key, O6 `/open`+`/import` on textsous.com (in
  progress: /import in dev, /open in design; past Nov 1 due date), O7
  privacy line, O8 demo video, O9 submission.
- M6: M6.2 + M6.5 closed; M6.1/M6.3/M6.4/M6.6 built, owner
  re-checks pending one push + deploy. Attribute tags deferred (owner
  thinking).
- Pre-warm evidence lived in `/tmp/prewarm*.log` (scratch, never committed);
  reproduce via the M5.2 procedure if needed.

## Environment quirks (this dev sandbox)

- External web fetching FAILS except allowlisted hosts (npm registry, the
  model API, and open.textsous.com work; blog/recipe pages fail or hang).
  Anything needing arbitrary web — URL eval runs, URL curation, localhost
  servers — must run elsewhere. Production fetches fine.
- The `tsx` CLI fails here (EPERM on its IPC pipe); run scripts locally
  with `node --import tsx <script>`. Committed `npm run` scripts are
  unaffected — CI and real machines run them normally.
- `npm ci` needs `--cache /tmp/npm-cache` (home dir unwritable).
- No port binding: verify UI via `renderToString` smokes and production,
  never a local server.
- `git push` auth fails here — the owner pushes from their own terminal.
  Commit only on explicit ask; never push on your own.
- The local model key lives in `.env.local` (gitignored). Source it for
  live runs; never print, copy, or commit it.

## Key commands

```sh
npm test && npm run typecheck && npm run lint   # gates (offline)
npm run build                                    # prod build
npm run smoke                                    # one tiny live call per provider
npx tsx src/cli.ts convert <url|file> --out /tmp/x.json [--timeline]
  [--servings n] [--dietary target] [--cuisine name] [--voice sous]
npm run eval [--fixtures-only] [--limit N] [--out path]   # live $, see M5.1
npm run schema && npm run docs                   # regen docs (CI gates the diff)
```

## Decisions worth knowing

- `GET /api/artifact/[id]`: 403 on tampered signature, 404 on expired or
  missing (ids are unguessable UUIDs, so the oracle risk is accepted).
- `ChatTextMessage` kept its name but is now a per-role union, so
  images-only-in-user-messages is compiler-checked.
- `/api/convert` accepts `{recipe}` for the photo-confirm flow; it skips
  canonicalize (empty stage report) so book credit survives.
- All route logs go through a redacting logger (URLs + data URLs stripped
  by construction, not by discipline).
- Friendly errors carry an optional `paste-text` action for URL-attributable
  failures (refused address, roundup page, unreachable site).
- The fetcher keeps its honest `TextSousOpen` user-agent; never impersonate
  a browser to bypass publisher gates — gated pages fail gracefully and the
  UI offers pasting the text instead.
