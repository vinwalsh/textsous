# Handoff: TextSous Open converter

For the next agent picking up this repo. Last updated: 2026-10-30.

## Where things stand

- **M1–M3** closed, pushed, deployed.
- **M4** built: M4.1 (photo), M4.3 (artifacts), M4.4 (docs), M4.5 (hardening)
  closed. M4.2 web flow built, owner phone check pending. M4.6 fixture perf
  measured; URL numbers need a networked env.
- **M5**: M5.4 (README) and M5.2 (20/20 demo pre-warm) closed. M5.1 runner
  built + fixture-validated; the full 23-row run needs a networked machine.
  M5.3/M5.5 pending (see below).
- Suite: 241/241 offline green (`MODEL_API_KEY` unset). Prod
  (open.textsous.com) deploys `main` on push. Local `main` is ahead of
  `origin/main` by 1 (demo page commit) plus an uncommitted photo-picker
  fix — push both together for the M4.2 re-check.
- Source of truth for status is TASKS.md; NEW-WORK.md is the dated work log;
  AGENTS.md holds the repo rules. README.md is user-facing.

## Open loops

- M4.2 phone check: owner walks every path on production.
- M5.1 full eval: run `npm run eval` on a networked machine (this sandbox
  cannot fetch external web). Optionally set `EVAL_USD_PER_MTOK` first.
  Commit the resulting 23-row `eval/RESULTS.md` after skimming it for
  third-party text (URL rows must show URLs only).
- M5.3: final NEW-WORK summary once the commit range is settled, plus the
  owner's private-repo handoff notes (not visible from here).
- M5.5: needs a push/deploy; also unresolved: the item says health "reports
  the Standard tier" but `/api/health` has no tier field — ask the owner
  what that check wants before closing.
- Owner items still open: O3 cap sizing (~20–25k tokens/conversion
  measured), O4 Baseten key, O6 `/open`+`/import` on textsous.com, O7
  privacy line, O8 demo video, O9 submission.
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
