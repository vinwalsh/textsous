# The submission video: a 3-minute shot list

Production is https://open.textsous.com. Record at phone width (390 × 844)
or a 1280 px window; the Cook Along view fits both. Every shot below is a
live page except the two `/simulate` replays, which say so on screen.

| # | Time | URL | What is on screen | What to say |
|---|------|-----|-------------------|-------------|
| 1 | 0:00–0:20 | `/cook-along-demo` | A finished Cook Along opens at once: lanes, the guided timeline, step cards with timers. Tap **Cook**. | "TextSous turns any recipe into a Cook Along: mise en place first, one lane per component, every step timed. This one is finished; here is how one gets written." |
| 2 | 0:20–1:00 | `/simulate/convert?speed=4` (or a fresh conversion from `/` if you have 75 s) | The cooking line sticks to the top; the facts land at once, the summary at 4 s, the ingredients and the adjust panel at 24 s, prep and steps at 48 s, then "Your Cook Along is ready". At ×4 the whole thing takes 18 s. | "A recipe page becomes a Cook Along in about a minute, and the page fills in as each part is ready: facts, a summary, ingredients, then the prep and steps, checked against the original before the timeline is built." Name the replay once: "This is a replay of a real conversion, sped up four times." |
| 3 | 1:00–1:35 | `/demo-sites/lemon-blueberry-muffins` → **Adjust with SOUS** → 18 servings → Apply | The demo blog's own page, the overlay, every amount rescaled from 12 to 18 muffins, the sections marked "Before your changes" while it applies. | "Recipe sites add one script and get this button. Ask SOUS for 18 muffins and every amount is rescaled by code, never by the model; diets and cuisines work the same way." |
| 4 | 1:35–2:10 | `/simulate/photo?speed=4` | Two photographed pages, "Transcribing… (replay)", the confirm screen with the transcription, **Looks right — convert it**, the recorded conversion, the finished Cook Along. | "Cookbook photos work too: up to three pages of one recipe, read once, shown to you to confirm before anything is converted. The photos never leave memory." |
| 5 | 2:10–2:30 | The finished Cook Along → **Save to TextSous** → Cookbook | The signed hand-off to textsous.com and the recipe in the Cookbook. (Needs the TextSous app's import PR live; otherwise show the button and say where it goes.) | "One tap saves it to your TextSous Cookbook, where SOUS can text you the steps while you cook." |
| 6 | 2:30–2:45 | `/assistants` → Muse | The directory of assistants and the Muse hand-off. | "Or stay in your own assistant: Muse, ChatGPT, Claude and Gemini all reach the same tools over MCP." |
| 7 | 2:45–3:00 | `/glasses` → `/simulate/glasses?speed=20` | The heads-up view on Meta Ray-Ban Display: the task now, what's next, the guide clock; in the replay the clock runs ×20 so steps come due in seconds. Timers stay real time. | "On Meta Ray-Ban Display the same Cook Along is a heads-up guide: it tells you what to do and what's next, and says each step out loud. Here the guide clock runs twenty times faster so you can see it move on." |

Tips: open every URL once before recording (the live pages are cached);
record `/simulate` pages after a reload so the clock starts at 0:00; the
bar at the bottom has Play, Pause, the speeds and Restart; ×8 fits the
conversion in 9 s if the cut is tight.

## What is simulated (for the submission text)

Two shots are replays, labeled on screen "Simulation: a replay of a real
conversion recorded on Nov 4, 2026". `/simulate/convert` and
`/simulate/photo` play back the exact NDJSON events production sent for two
of our own CC0 recipes (a recipe page and two photographed cookbook pages),
at the seconds they arrived, through the same reducer, progressive view and
finished page a live conversion uses; only the clock is faster.
`/simulate/glasses` is the real heads-up view on that finished recipe with
its guide clock running twenty times faster, so steps come due in seconds;
timers stay on real time. No simulation calls the model or applies
adjustments: adjustments, saving and the hand-offs are live on the real
pages, and every other shot in the video is the live site.
