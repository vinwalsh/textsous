import { EU14_ALLERGENS } from "../schema/canonical";
import { ERROR_FIXES } from "./errors";

/** Bumped when the skills request or response shape changes. */
export const SKILLS_VERSION = 1;

const errorTable = Object.entries(ERROR_FIXES)
  .map(([code, fix]) => `| \`${code}\` | ${fix} |`)
  .join("\n");

/**
 * How an AI assistant turns a recipe into a TextSous Cook Along, served as
 * markdown by GET /api/skills/format. Written for any assistant (Muse,
 * ChatGPT, Claude, Gemini) calling the TextSous tools.
 */
export const SKILLS_INSTRUCTIONS = `# Turn a recipe into a TextSous Cook Along

A Cook Along is a recipe laid out for one cook: mise en place first, then
cooking tasks on parallel component lanes, each with a timer and a clear
"done" cue. You do the reading and writing with your own model. TextSous
checks your work, builds the schedule, and stores the result so it opens on
open.textsous.com (and, through the TextSous assistant tools, in the
person's TextSous Cookbook).

## The flow

1. **Read the format** (this document, the input schema and the example).
2. **Get the recipe** from a link, pasted text or a photo (below).
3. **Write** \`recipe\` and \`timeline\` following the rules below.
4. **Save** with the cook-along call (\`save_cook_along\`, or
   \`POST /api/skills/cook-along\`): \`{ "source", "recipe", "timeline" }\`.
5. **Fix and retry** if the call returns errors (see "Fixing errors").
6. **Share** the returned link with the person and give the summary.

## 1. Getting the recipe

**A link.** Call the source tool (\`get_recipe_source\`, or
\`POST /api/skills/source\` with \`{ "url" }\`). Work only from what it returns:
\`jsonLd\` (the page's structured recipe, when it has one) and \`text\`. Keep
the credit: \`source.kind\` "url", \`source.url\` set to the returned \`url\`, and
\`site\` and \`author\` as returned. If it reports several recipes on the page,
ask the person which one they want. If the page cannot be read, ask them to
paste the recipe text.

**Pasted text.** \`source.kind\` "text" and \`source.text\` set to the text
exactly as the person pasted it. Credit any site or author the text names.

**A photo** (a cookbook page, a card, a screenshot). Transcribe it exactly,
word for word: every ingredient line and every step, with the amounts, units
and times as printed. Do not fix, convert or complete anything; if a word is
unreadable, ask. Show the person your transcription and ask them to confirm or
correct it **before** you save. Capture the book title, author and page number
when they are visible (\`source.book\`, \`source.author\`, \`source.page\`). Then
\`source.kind\` "photo" and \`source.text\` set to the confirmed transcription.

## 2. The canonical recipe (\`recipe\`)

- \`title\` as printed. \`servings\`: the number the source makes (ask if the
  source does not say). \`cuisine\` only if the source names one.
- \`ingredients\`: one entry per ingredient line, in source order.
  - \`name\` without the amount ("rolled oats").
  - \`quantity\` exactly as printed ("1 1/2", "1/4"); "" when the source gives
    no amount ("salt to taste").
  - \`unit\` exactly as printed ("cups", "tablespoon"); "" when there is none.
  - \`note\`: the preparation or descriptor from the line ("diced", "drained
    and rinsed", "at room temperature").
  - \`allergens\`: EU-14 slugs the ingredient definitely contains, from this
    list only: ${EU14_ALLERGENS.join(", ")}. \`allergenTraces\` for "may
    contain". When unsure, leave the list empty: empty means unknown, never
    allergen-free.
- \`steps\`: every method step in source order, text verbatim (drop only the
  numbering). \`kind\` "active" for method steps; "prep" only for a mise en
  place step the source states on its own ("Preheat the oven", "Chop all the
  vegetables").
- \`equipment\`: what the source names.
- **Never invent** ingredients, amounts, times, temperatures or equipment.
  **No nutrition or health claims** anywhere: no calories, "healthy",
  "guilt-free", diet labels or benefits.

## 3. The timeline (\`timeline\`)

**Lanes.** One lane per component of the dish (sauce, protein, base, side,
garnish: only those this recipe has), \`kind\` "component". Then exactly one
kitchen lane, \`kind\` "kitchen", **last**, for shared work such as preheating
and plating.

**Mise en place first.** Prep tasks (\`phase\` "prep") hold all cutting,
measuring and setup that can happen before the heat goes on. Every prep task
finishes before the first cook task starts, and a prep task may depend only on
other prep tasks.

**Oven first.** When the recipe uses the oven, the first prep task preheats
it: hands-on, 1 minute, kitchen lane, \`equipmentEvent\` "oven-on", the
temperature in the description ("Heat the oven to 400°F."). The first task
that puts food in the oven depends on it; TextSous adds the 10-minute heat-up
there, so do not add a waiting task. The last oven task carries "oven-off".

**One prep task per prep action named in the ingredient notes.** "1 onion,
diced" gets a "Dice onion" prep task; "2 garlic cloves, minced" gets a "Mince
garlic" prep task. Cite that ingredient in the prep task's \`ingredientIds\`
and the step where it is used in \`sourceStepIds\`.

**Amounts live in descriptions, never in card titles.** Each \`description\`
says the exact amount, unit and ingredient name: "Pour 2 cups whole milk over
the oats and add 1 pinch fine sea salt." \`label\` and \`cardTitle\` (\`action\`,
\`subject\`, \`context\`) never carry amounts, times or temperatures:
\`{ "action": "Simmer", "subject": "porridge", "context": "stirring often" }\`.

**Batches.** When the source cooks in rounds ("fry in 3 batches, 4 minutes
per batch"), make one grouped task: keep the round count and the per-round
time in the description, set \`minutes\` to the total (3 x 4 = 12), and add a
checkpoint per round.

**Prepared inputs.** When an ingredient is a prepared food the recipe
assumes (cooked pasta, cooked rice, mashed potatoes, a stock made earlier),
add one cook task in that component's lane to have it ready by serving time,
\`timingBasis\` "estimate", citing that ingredient and the step that uses it.
Describe it in one sentence; never invent a sub-recipe or amounts.

**Hands-on setup is split from unattended cooking.** "Add the stock, bring
to a boil, then simmer 20 minutes" becomes a hands-on task ("Add stock and
bring to a boil") and an unattended task ("Simmer") that depends on it.
\`attention\` is "hands-on" while the cook works, "unattended" while the oven,
pot or timer does the work. There is one cook: TextSous never overlaps two
hands-on tasks, and runs unattended tasks alongside them.

**Timing.** \`minutes\` is a whole number from 1 to 180. \`timingBasis\` is
"source" **only** when the source states that exact duration; then
\`sourceQuote\` is the exact words that state it ("simmer 6 minutes"), copied
character for character from one step's text (which itself is verbatim from
the source). Everything else is "estimate" with no \`sourceQuote\`. When the
source gives a span ("8 to 10 minutes"), set \`range\` \`{ "low": 8, "high": 10 }\`
and \`minutes\` inside it. Timers default on only for source timings.

**References.**
- \`sourceStepIds\`: at least one step id each task comes from.
- \`laneIds\`: at least one lane.
- \`dependencies\`: ids of tasks that must finish first (omit for none).
- \`ingredientIds\`: the ingredients the task uses. **Every ingredient must be
  used by at least one task.**
- \`resourceIds\`: pans, burners or the oven the task holds, declared in
  \`timeline.resources\` (\`{ "id", "label", "kind" }\`). Two tasks holding the same
  pan never overlap.

**Cues.** \`completionCue\` is an observable sign the task is done (color,
texture, smell, sound, temperature). A hands-on task over 15 minutes needs
\`checkpoints\` (observable sub-cues) or should be split. \`tip\` is optional:
at most one short tip, only from the source's own advice. \`why\` is optional:
one sentence on why the task matters or is done this way (no health or
nutrition claims).
\`equipmentEvent\` is "oven-on" on the preheat task and "oven-off" once the oven
is no longer needed.

**Serving.** The last task is the plating or serving task, \`phase\` "finish";
\`serveTaskId\` names it (it defaults to the last finish task).

**Do not schedule.** Never give start times. TextSous computes the schedule
from phases, dependencies, attention and resources.

**Optional fields.** You may leave out ids (\`ing-1\`, \`step-1\` and
\`task-<slug>\` are filled in; the slug is the label lowercased, every run of
other characters turned into one hyphen, cut to 40 characters, with \`-2\`,
\`-3\` added on a clash: "Toast the oats (lightly)" becomes
\`task-toast-the-oats-lightly\`), lane colors, \`cardTitle\` (derived from
\`label\`), \`checkpoints\`, \`dependencies\`, \`ingredientIds\`, \`resourceIds\`,
\`resources\`, \`resourceHolds\` and \`serveTaskId\`. If you leave out ids,
reference ingredients and steps by their position ids (\`ing-3\` is the third
ingredient). Give every ingredient (and every step) an id, or none.

## 4. Fixing errors

A failed save returns \`{ "ok": false, "errors": [{ "path", "code",
"message" }] }\`. \`path\` points at the field to fix, for example
\`timeline.tasks[3].sourceStepIds[0]\`; \`message\` says how to fix it. Fix every
listed error, then send the **whole** body again. Never fix an error by
inventing content: if the source does not support a timing, make it an
estimate; if an ingredient is unused, cite it in the task that uses it.

| code | how to fix |
| --- | --- |
${errorTable}

A successful save may also return \`warnings\` (advice, not blockers): read
them and improve the next cook along.

## 5. Sharing the result

A successful save returns \`viewUrl\` (open this to cook along; the link works
for 24 hours, the Cookbook copy stays) and a \`summary\` with the total and
hands-on minutes from the TextSous schedule. Tell the person the title,
servings, total and hands-on time, and the allergens as "Contains: milk,
gluten. Check labels." Never say a recipe is "safe for" anyone.
`;
