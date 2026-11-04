# TextSous skills API

The skills API lets an AI assistant (Muse from Meta, ChatGPT, Claude, Gemini,
or your own agent) turn a recipe into a TextSous Cook Along **with its own
model**. The assistant does the language work: reading the recipe, writing
the canonical recipe and the timeline. This server does the rest, in code:
it serves the format instructions, fetches recipe pages safely, fills
defaults, validates strictly, schedules, compiles and stores the result so
it opens on open.textsous.com.

No route here calls a model, and none counts toward the site's daily free
conversions.

## Endpoints

Base origin: `https://open.textsous.com`. All bodies are JSON, capped at
256 KB. Every route allows up to 60 seconds.

### `GET /api/skills/format` (public)

```json
{
  "skillsVersion": 1,
  "formatVersion": 1,
  "instructions": "# Turn a recipe into a TextSous Cook Along ...",
  "inputSchema": { "type": "object", "properties": { "source": {}, "recipe": {}, "timeline": {} } },
  "example": { "source": {}, "recipe": {}, "timeline": {} }
}
```

- `instructions`: markdown for the assistant. It covers getting the recipe
  (link, pasted text, photo transcription confirmed with the person before
  saving), the canonical recipe rules, the timeline rules (mise en place
  first, one prep task per prep action in the ingredient notes, amounts in
  descriptions and never in card titles, batches, hands-on vs unattended,
  source timings with exact quotes, lanes, EU-14 allergens), and how to fix
  each error code.
- `inputSchema`: JSON Schema of the cook-along body, inline (no `$ref`).
- `example`: a complete valid body, built from the original fixture
  `eval/fixtures/toasted-oat-porridge.html` and its recordings.
- `Cache-Control: public, max-age=300`.

### `POST /api/skills/source` (secret)

Body: `{ "url": "https://..." }`. Fetches the page through the same guarded
intake the converter uses (public https only, private networks refused,
2 MB and 3-redirect caps, 10 s timeout).

200:

```json
{
  "ok": true,
  "source": {
    "url": "https://example.com/recipes/toasted-oat-porridge",
    "site": "TextSous Fixtures",
    "author": "TextSous Kitchen",
    "title": "Toasted Oat Porridge with Brown Butter Apples",
    "jsonLd": {
      "name": "...", "author": "...", "recipeYield": "2 servings",
      "recipeIngredient": ["1 cup rolled oats", "..."],
      "recipeInstructions": ["Toast the rolled oats ...", "[Apples] Melt the butter ..."]
    },
    "text": "Title, credit, ingredients, instructions, then the page text (max 60,000 chars)"
  }
}
```

`url` is the page's canonical https URL (tracking parameters removed).
`jsonLd` is `null` when the page has no schema.org Recipe.

422: `{ "ok": false, "error": { "code", "message" } }` with `code` one of
`refused_url`, `multiple_recipes`, `fetch_failed`, `not_a_recipe`. The
message tells the assistant what to ask the person. A page without
schema.org data counts as a recipe when its text has both an ingredients and
an instructions heading, or at least three measured amounts ("2 tablespoons",
"250 g"), which covers blog recipe cards that use other headings.

### `POST /api/skills/cook-along` (secret)

Body (lenient; see `inputSchema` and `example`):

```json
{
  "source": { "kind": "url | text | photo", "url": "...", "site": "...", "author": "...",
              "book": "...", "page": 12, "text": "the recipe text the assistant worked from" },
  "recipe": { "title": "...", "cuisine": "...", "servings": 4,
              "ingredients": [{ "name": "...", "quantity": "1 1/2", "unit": "cups", "note": "diced", "allergens": ["milk"] }],
              "steps": [{ "kind": "active", "text": "..." }],
              "equipment": ["large skillet"] },
  "timeline": { "lanes": [{ "id": "lane-sauce", "label": "Sauce", "kind": "component" }],
                "tasks": [{ "phase": "cook", "label": "...", "description": "...", "completionCue": "...",
                            "minutes": 5, "timingBasis": "estimate", "attention": "hands-on",
                            "laneIds": ["lane-sauce"], "sourceStepIds": ["step-2"], "ingredientIds": ["ing-3"] }] }
}
```

What the server does, in order:

1. Parses the lenient body. Unknown keys are dropped with an
   `unknown_field` warning.
2. Resolves the source. For `kind: "url"` it re-fetches the page through the
   intake for authoritative credit (url, site, author) and source text; if
   that fails it uses the body's `source.text` and returns a
   `source_fetch_failed` warning. A private or non-https URL is refused.
   `text` and `photo` require `source.text`.
3. Fills defaults: `ing-N`, `step-N` and `task-<slug of label>` ids, the
   canonical `version`, `id` and `sourceFingerprint`, empty allergen lists
   (common words like "dairy" map to EU-14 slugs with a warning), lane colors
   and kinds, `cardTitle` from `label` (context ""), `timerEnabledByDefault`
   (true only for `timingBasis: "source"`), empty checkpoints and scheduling,
   `serveTaskId` (the last finish task) and the default equipment profile
   (4 burners and an oven).
4. Validates strictly with the real canonical and timeline zod schemas plus
   path-specific rule checks: references, duplicate ids, lanes, mise en place,
   dependency cycles, source quotes (verbatim in a step and in the source
   text), numbers in card titles, unused ingredients, long hands-on tasks.
5. Runs `runProcedureChecks`, the code `schedule`, `runCodedReviewChecks` and
   `compile`. The 7 model review judgments are recorded as **not run**
   (`notRun: true`), because the recipe was authored by the person's own
   assistant; they never block compile. Allergens roll up inside `compile`.
6. Stores the artifact for 24 hours (the same store as "Save to TextSous")
   and signs its URL.

200:

```json
{
  "ok": true,
  "artifactId": "0b6c5d0e-1c4f-4a43-9c55-0d0c3c1f1a7e",
  "artifactUrl": "https://open.textsous.com/api/artifact/0b6c5d0e-1c4f-4a43-9c55-0d0c3c1f1a7e?sig=<64 hex>",
  "viewUrl": "https://open.textsous.com/?src=<encodeURIComponent(artifactUrl)>",
  "expiresAt": "2026-11-05T21:00:00.000Z",
  "summary": { "title": "...", "servings": 2, "totalMinutes": 15, "handsOnMinutes": 15, "taskCount": 7, "allergens": ["gluten", "milk"] },
  "warnings": [{ "code": "amount_missing", "path": "recipe.ingredients[2]", "message": "..." }]
}
```

`artifactUrl` always has the shape textsous.com's importer accepts:
`<origin>/api/artifact/<lowercase uuid>?sig=<64 lowercase hex>`, nothing
else in the query. `totalMinutes` and `handsOnMinutes` come from the code
schedule, never from the assistant.

422:

```json
{ "ok": false,
  "errors": [{ "path": "timeline.tasks[3].sourceStepIds[0]", "code": "unknown_reference",
               "message": "Cite a step id from recipe.steps (step-1, step-2, ...); \"step-9\" does not exist." }],
  "warnings": [] }
```

The full list of error codes and their fixes is in the `instructions`
(section "Fixing errors"), generated from `src/lib/skills/errors.ts`.

### Shared responses

| Status | Body | When |
| --- | --- | --- |
| 503 | `{ "ok": false, "error": { "code": "not_configured" } }` | `SKILLS_API_SECRET` is unset on the server (secret routes only) |
| 401 | `{ "ok": false, "error": { "code": "unauthorized" } }` | missing or wrong `Authorization: Bearer <secret>` |
| 413 | `{ "ok": false, "error": { "code": "too_large" } }` | body over 256 KB |
| 400 | `{ "ok": false, "error": { "code": "invalid_json" } }` | body is not JSON |
| 429 | `{ "ok": false, "error": { "code": "rate_limited" } }` | over 600 requests/hour per secret, or 60/hour per `X-TextSous-Account` |

The secret is compared in constant time. `X-TextSous-Account` is optional:
an opaque per-person hash the caller sends so one person cannot use up the
shared budget. Limits use Upstash Redis in production and memory in
development.

## How the TextSous MCP uses it

textsous.com runs the TextSous MCP server at `https://textsous.com/api/mcp`.
People add that address to their assistant as a connector and sign in with
their TextSous account (see `/assistants`). The MCP exposes three tools that
call this API server to server with the shared secret:

1. `get_cook_along_format`: returns `instructions` and `inputSchema` from
   `GET /api/skills/format` (cached for 10 minutes).
2. `get_recipe_source`: `{ url }` to `POST /api/skills/source`.
3. `save_cook_along`: the cook-along body to `POST /api/skills/cook-along`,
   with an `X-TextSous-Account` hash. On success it imports `artifactUrl`
   into the person's TextSous Cookbook and returns `viewUrl`, the Cookbook
   link and the summary. On 422 it hands the `errors` back to the assistant,
   which fixes them and calls again.

The assistant does the language work with its own model, so a busy day on
open.textsous.com (when the free daily conversions run out) does not stop
anyone: the converter's daily-cap message links to `/assistants`.

## Self-hosting

- Set `SKILLS_API_SECRET` to a long random value (for example
  `openssl rand -hex 32`) to enable the two secret routes. Without it they
  return 503 `not_configured`; `GET /api/skills/format` works either way.
- `ARTIFACT_SIGNING_SECRET` must be set to store and sign artifacts (the
  same variable "Save to TextSous" uses).
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (optional) move the
  artifact store and rate limits from the local filesystem and memory to
  Redis.
- `PUBLIC_ORIGIN` (optional) sets the origin used in `artifactUrl` and
  `viewUrl`. Default: `https://open.textsous.com` on Vercel production, the
  request's own origin everywhere else (local runs, preview deployments).
- Give your MCP server or agent the same secret and send it as
  `Authorization: Bearer <secret>`. Never expose it to a browser.
