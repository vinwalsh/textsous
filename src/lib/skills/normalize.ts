import { createHash } from "node:crypto";
import { firstSentence } from "../format";
import { fingerprintSource } from "../intake/fingerprint";
import { KITCHEN_LANE_COLOR, componentLaneColor } from "../lane-palette";
import { EU14_ALLERGENS, type CanonicalRecipe } from "../schema/canonical";
import type { Lane, TimelineDefinition, TimelineTask } from "../schema/timeline";
import type { SkillsWarning } from "./errors";
import type { CookAlongRequest, SkillsTask } from "./input";

/** Credit and source text the server settled on (re-fetched for url kind). */
export interface ResolvedSource {
  kind: "url" | "text" | "photo";
  url: string | null;
  site: string | null;
  author: string | null;
  book: string | null;
  page: number | null;
  license: string | null;
  /** Text used for quote and fidelity checks; null when none is available. */
  text: string | null;
}

export interface NormalizedCookAlong {
  recipe: CanonicalRecipe;
  timeline: TimelineDefinition;
  warnings: SkillsWarning[];
}

/** Time the oven takes to heat after the preheat task (10 minutes). */
export const OVEN_HEAT_SECONDS = 600;

const HEX_COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Common non-slug allergen words assistants use, mapped to EU-14 slugs. */
const ALLERGEN_SYNONYMS: Record<string, string> = {
  dairy: "milk",
  lactose: "milk",
  wheat: "gluten",
  "cereals containing gluten": "gluten",
  eggs: "egg",
  "tree nuts": "nuts",
  "tree-nuts": "nuts",
  "tree nut": "nuts",
  treenuts: "nuts",
  nut: "nuts",
  peanut: "peanuts",
  soya: "soy",
  soybeans: "soy",
  soybean: "soy",
  sulfites: "sulphites",
  sulfite: "sulphites",
  sulphite: "sulphites",
  "sulphur dioxide": "sulphites",
  "sulfur dioxide": "sulphites",
  "sesame seeds": "sesame",
  crustacean: "crustaceans",
  mollusc: "molluscs",
  mollusk: "molluscs",
  mollusks: "molluscs",
  lupine: "lupin",
};

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "step";
}

function mapAllergens(
  values: string[] | null | undefined,
  path: string,
  warnings: SkillsWarning[],
): string[] {
  const out: string[] = [];
  (values ?? []).forEach((raw, i) => {
    const lower = raw.trim().toLowerCase();
    let slug = lower;
    if (!(EU14_ALLERGENS as readonly string[]).includes(lower) && ALLERGEN_SYNONYMS[lower]) {
      slug = ALLERGEN_SYNONYMS[lower];
      warnings.push({
        code: "allergen_mapped",
        path: `${path}[${i}]`,
        message: `"${raw}" was saved as the EU-14 slug "${slug}". Use the slug next time.`,
      });
    }
    if (!out.includes(slug)) out.push(slug);
  });
  return out;
}

function deriveCardTitle(label: string): TimelineTask["cardTitle"] {
  const words = label.trim().split(/\s+/);
  const action = words[0] ?? label;
  const subject = words.slice(1).join(" ") || action;
  return { action, subject, context: "" };
}

function roundMinutes(value: number, path: string, warnings: SkillsWarning[]): number {
  if (Number.isInteger(value)) return value;
  const rounded = Math.round(value);
  warnings.push({
    code: "minutes_rounded",
    path,
    message: `${value} was rounded to ${rounded}: minutes are whole numbers.`,
  });
  return rounded;
}

/**
 * Ids for entries the assistant sent without one: `<prefix>-<position>`.
 * When another entry already uses that id, the entry gets the next free
 * number past the list's length (so it never takes a position id a task may
 * cite) and a warning names it. Given ids are kept as they are.
 */
function fillIds(
  given: Array<string | null | undefined>,
  prefix: string,
  path: string,
  warnings: SkillsWarning[],
): string[] {
  const taken = new Set(given.map((id) => clean(id)).filter((id): id is string => !!id));
  let next = given.length + 1;
  return given.map((raw, i) => {
    const id = clean(raw);
    if (id) return id;
    const positional = `${prefix}-${i + 1}`;
    if (!taken.has(positional)) {
      taken.add(positional);
      return positional;
    }
    while (taken.has(`${prefix}-${next}`)) next += 1;
    const assigned = `${prefix}-${next}`;
    taken.add(assigned);
    warnings.push({
      code: "id_assigned",
      path: `${path}[${i}].id`,
      message: `This entry had no id and "${positional}" is used by another entry, so it was given "${assigned}". Give every entry an id, or none.`,
    });
    return assigned;
  });
}

/**
 * Fill the C3.3 defaults: ids, canonical version/id/fingerprint, allergen
 * lists, lane colors and kinds, card titles, timers, checkpoints, scheduling
 * and the serve task. Pure. Does not validate: `validateCookAlong` does that
 * against the real schemas and rules afterwards.
 */
export function normalize(body: CookAlongRequest, source: ResolvedSource): NormalizedCookAlong {
  const warnings: SkillsWarning[] = [];
  const { recipe: r, timeline: t } = body;

  const ingredientIds = fillIds(r.ingredients.map((ing) => ing.id), "ing", "recipe.ingredients", warnings);
  const ingredients = r.ingredients.map((ing, i) => ({
    id: ingredientIds[i],
    name: ing.name.trim(),
    quantity: ing.quantity === null || ing.quantity === undefined ? "" : String(ing.quantity).trim(),
    unit: (ing.unit ?? "").trim(),
    quantity4: null,
    scaleRule: null,
    cookQuantity: null,
    buyQuantity: null,
    allergens: mapAllergens(ing.allergens, `recipe.ingredients[${i}].allergens`, warnings),
    allergenTraces: mapAllergens(ing.allergenTraces, `recipe.ingredients[${i}].allergenTraces`, warnings),
    note: clean(ing.note),
  })) as CanonicalRecipe["ingredients"];

  const stepIds = fillIds(r.steps.map((step) => step.id), "step", "recipe.steps", warnings);
  const steps = r.steps.map((step, i) => ({
    id: stepIds[i],
    kind: step.kind ?? "active",
    text: step.text.trim(),
  }));

  const fingerprint = fingerprintSource([
    source.url ?? "",
    r.title,
    ...ingredients.map((ing) => `${ing.quantity} ${ing.unit} ${ing.name}`),
    ...steps.map((s) => s.text),
  ]);

  const recipe: CanonicalRecipe = {
    version: 1,
    id: `rcp-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`,
    title: r.title.trim(),
    source: {
      kind: source.kind,
      url: source.url,
      site: source.site,
      author: source.author,
      book: source.book,
      page: source.page,
      license: source.license,
    },
    cuisine: clean(r.cuisine),
    nativeServings: r.servings,
    servingsLarge: null,
    scalingNotes: null,
    ingredients,
    steps,
    equipment: (r.equipment ?? []).map((e) => e.trim()).filter(Boolean),
    sourceFingerprint: fingerprint,
  };

  let componentIndex = 0;
  const lanes: Lane[] = t.lanes.map((lane) => {
    const kind =
      lane.kind ?? (/kitchen/i.test(`${lane.id} ${lane.label}`) ? "kitchen" : "component");
    const given = clean(lane.color);
    const color =
      given && HEX_COLOR.test(given)
        ? given
        : kind === "kitchen"
          ? KITCHEN_LANE_COLOR
          : componentLaneColor(componentIndex);
    if (kind === "component") componentIndex += 1;
    return { id: lane.id.trim(), label: lane.label.trim(), color, kind };
  });

  const givenTaskIds = new Set(t.tasks.map((task) => clean(task.id)).filter((id): id is string => !!id));
  const usedIds = new Set<string>();
  const taskId = (task: SkillsTask): string => {
    const given = clean(task.id);
    if (given) return given;
    const base = `task-${slugify(task.label)}`;
    let candidate = base;
    for (let n = 2; usedIds.has(candidate) || givenTaskIds.has(candidate); n += 1) {
      candidate = `${base}-${n}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const tasks: TimelineTask[] = t.tasks.map((task, i) => {
    const path = `timeline.tasks[${i}]`;
    let quote = clean(task.sourceQuote);
    if (task.timingBasis === "estimate" && quote) {
      warnings.push({
        code: "quote_dropped",
        path: `${path}.sourceQuote`,
        message: 'An "estimate" timing carries no quote, so the quote was dropped.',
      });
      quote = null;
    }
    const cardTitle = task.cardTitle
      ? {
          action: task.cardTitle.action.trim(),
          subject: task.cardTitle.subject.trim(),
          context: (task.cardTitle.context ?? "").trim(),
        }
      : deriveCardTitle(task.label);
    return {
      id: taskId(task),
      phase: task.phase,
      label: task.label.trim(),
      cardTitle,
      description: task.description.trim(),
      completionCue: task.completionCue.trim(),
      minutes: roundMinutes(task.minutes, `${path}.minutes`, warnings),
      range: task.range
        ? {
            low: roundMinutes(task.range.low, `${path}.range.low`, warnings),
            high: roundMinutes(task.range.high, `${path}.range.high`, warnings),
          }
        : null,
      timingBasis: task.timingBasis,
      sourceQuote: task.timingBasis === "source" ? quote : null,
      attention: task.attention,
      timerEnabledByDefault: task.timingBasis === "source",
      laneIds: task.laneIds.map((id) => id.trim()),
      dependencies: (task.dependencies ?? []).map((id) => id.trim()),
      sourceStepIds: task.sourceStepIds.map((id) => id.trim()),
      checkpoints: (task.checkpoints ?? []).map((c) => c.trim()).filter(Boolean),
      tip: clean(task.tip),
      why: firstSentence(clean(task.why)),
      equipmentEvent: task.equipmentEvent ?? null,
      scheduling: {
        waits: [],
        resourceIds: (task.resourceIds ?? []).map((id) => id.trim()),
        ingredientIds: (task.ingredientIds ?? []).map((id) => id.trim()),
      },
    };
  });

  // The oven heats while the cook preps: as in the converter's procedure rule,
  // the first non-prep task after the preheat waits OVEN_HEAT_SECONDS. Prep
  // chained after the preheat only for order never waits.
  const preheatIds = new Set(tasks.filter((task) => task.equipmentEvent === "oven-on").map((task) => task.id));
  const firstOvenTask = tasks.find(
    (task) => task.phase !== "prep" && task.dependencies.some((id) => preheatIds.has(id)),
  );
  if (firstOvenTask) firstOvenTask.scheduling.waits = [OVEN_HEAT_SECONDS];

  const lastFinish = [...tasks].reverse().find((task) => task.phase === "finish");
  const serveTaskId = clean(t.serveTaskId) ?? lastFinish?.id ?? tasks[tasks.length - 1]?.id ?? "";

  const timeline: TimelineDefinition = {
    lanes,
    tasks,
    resources: (t.resources ?? []).map((res) => ({
      id: res.id.trim(),
      label: res.label.trim(),
      kind: res.kind.trim(),
    })),
    resourceHolds: (t.resourceHolds ?? []).map((hold) => ({
      taskId: hold.taskId.trim(),
      resourceId: hold.resourceId.trim(),
    })),
    serveTaskId,
  };

  return { recipe, timeline, warnings };
}
