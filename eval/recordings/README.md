# eval/recordings

Recorded model responses for offline stage tests, so CI runs without a key.

Each `<fixture>.json` holds the `RecordingFile` for one fixture: the exact
`CanonicalizeInput` the model saw plus its verbatim successful response.
`tests/canonicalize-recordings.test.ts` replays them through the canonical
schema and `runCanonicalChecks`. The `.doctored` file is the porridge
recording with one ingredient removed; it must fail `ingredient_count`.

Regenerate with live model calls (fixtures only):

```
node --import tsx src/cli.ts convert eval/fixtures/<name> --out /tmp/x.json --record
```

Store only responses derived from rights-safe fixtures under `eval/fixtures/`.
