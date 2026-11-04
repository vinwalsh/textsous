import { EU14_ALLERGENS, type Eu14Allergen } from "./schema/canonical";
import type { CookAlongArtifact } from "./schema/artifact";

/**
 * Deterministic allergen floor. The model tags allergens it is certain of;
 * this table adds the ones an ingredient name or note plainly implies, so a
 * missed tag (flour without gluten) cannot reach the cook as "not listed".
 * It only ever adds: model tags are never removed. Uncertain cases (oats,
 * stock) become traces. Missing tags still mean unknown, never allergen-free.
 */

interface AllergenRule {
  allergen: Eu14Allergen;
  /** Definite presence. Word-boundary, plural aware. */
  terms: string[];
  /** Possible presence: recorded as a trace. */
  traceTerms?: string[];
  /** Phrases removed from the text before this rule matches. */
  exclude?: string[];
  /** When this matches, the rule is skipped for the ingredient entirely. */
  skipIf?: RegExp;
}

const VEGAN = /\b(vegan|plant based|dairy free|non dairy|nondairy)\b/;

const NAMED_CHEESES = [
  "parmesan",
  "parmigiano",
  "parmigiano reggiano",
  "pecorino",
  "mozzarella",
  "cheddar",
  "ricotta",
  "feta",
  "gouda",
  "gruyere",
  "brie",
  "camembert",
  "mascarpone",
  "halloumi",
  "paneer",
  "emmental",
  "emmentaler",
  "manchego",
  "provolone",
  "asiago",
  "burrata",
  "queso",
  "cotija",
  "monterey jack",
  "colby",
  "stilton",
  "gorgonzola",
  "roquefort",
  "comte",
  "fontina",
  "taleggio",
  "quark",
  "labneh",
  "grana padano",
  "jarlsberg",
  "havarti",
];

const NAMED_FISH = [
  "anchovy",
  "salmon",
  "tuna",
  "cod",
  "haddock",
  "halibut",
  "trout",
  "sardine",
  "mackerel",
  "tilapia",
  "snapper",
  "sea bass",
  "bass",
  "catfish",
  "pollock",
  "swordfish",
  "mahi mahi",
  "herring",
  "flounder",
  "branzino",
  "monkfish",
  "perch",
  "pike",
  "carp",
  "eel",
  "bonito",
  "katsuobushi",
  "surimi",
  "whitefish",
  "hake",
  "sea bream",
  "bream",
  "skate",
  "turbot",
  "caviar",
  "roe",
  "lox",
];

const RULES: AllergenRule[] = [
  {
    allergen: "gluten",
    terms: [
      "wheat",
      "flour",
      "bread",
      "breadcrumb",
      "bread crumb",
      "panko",
      "pasta",
      "noodle",
      "spaghetti",
      "macaroni",
      "penne",
      "fettuccine",
      "linguine",
      "rigatoni",
      "fusilli",
      "farfalle",
      "lasagna",
      "lasagne",
      "orzo",
      "couscous",
      "bulgur",
      "bulghur",
      "farro",
      "barley",
      "rye",
      "spelt",
      "semolina",
      "seitan",
      "beer",
      "ale",
      "lager",
      "stout",
      "soy sauce",
      "shoyu",
      "teriyaki",
      "malt",
      "malt vinegar",
      "durum",
      "kamut",
      "einkorn",
      "triticale",
      "freekeh",
      "udon",
      "ramen",
      "crouton",
      "cracker",
      "pita",
      "naan",
      "baguette",
      "brioche",
      "ciabatta",
      "focaccia",
      "sourdough",
      "puff pastry",
      "pastry",
      "phyllo",
      "filo",
      "pie crust",
      "tortellini",
      "ravioli",
      "gnocchi",
      "wonton wrapper",
      "dumpling wrapper",
      "graham cracker",
      "shaoxing",
    ],
    traceTerms: ["oat", "oats", "oatmeal", "hoisin", "tamari", "soba"],
    exclude: [
      "almond flour",
      "coconut flour",
      "rice flour",
      "chickpea flour",
      "corn flour",
      "cornflour",
      "tapioca flour",
      "potato flour",
      "cassava flour",
      "buckwheat flour",
      "lupin flour",
      "oat flour",
      "rice noodle",
      "glass noodle",
      "cellophane noodle",
      "bean thread noodle",
      "shirataki noodle",
      "kelp noodle",
      "zucchini noodle",
      "rice pasta",
      "chickpea pasta",
      "lentil pasta",
      "rice vermicelli",
      "root beer",
      "ginger beer",
      "ginger ale",
      "wheat free",
      "sweet potato noodle",
    ],
    skipIf: /\b(gluten free|gf)\b/,
  },
  {
    allergen: "milk",
    terms: [
      "milk",
      "butter",
      "buttermilk",
      "cream",
      "sour cream",
      "heavy cream",
      "whipping cream",
      "half and half",
      "creme fraiche",
      "cheese",
      ...NAMED_CHEESES,
      "yogurt",
      "yoghurt",
      "ghee",
      "whey",
      "casein",
      "lactose",
      "milk chocolate",
      "white chocolate",
      "kefir",
      "skyr",
      "creamer",
      "ice cream",
      "pesto",
    ],
    traceTerms: ["chocolate"],
    exclude: [
      "coconut milk",
      "coconut cream",
      "coconut yogurt",
      "cream of tartar",
      "almond milk",
      "oat milk",
      "soy milk",
      "soya milk",
      "rice milk",
      "cashew milk",
      "hemp milk",
      "pea milk",
      "oat cream",
      "cashew cream",
      "soy cream",
      "soy yogurt",
      "almond yogurt",
      "peanut butter",
      "almond butter",
      "cashew butter",
      "nut butter",
      "seed butter",
      "apple butter",
      "cocoa butter",
      "shea butter",
      "butter bean",
      "butter lettuce",
      "butternut",
      "nutritional yeast",
    ],
    skipIf: VEGAN,
  },
  {
    allergen: "egg",
    terms: ["egg", "yolk", "egg white", "egg yolk", "mayonnaise", "mayo", "aioli", "meringue"],
    traceTerms: ["caesar dressing"],
    exclude: ["eggplant", "flax egg", "chia egg", "egg replacer", "egg substitute"],
    skipIf: /\b(vegan|egg free|eggless|plant based)\b/,
  },
  {
    allergen: "fish",
    terms: ["fish", ...NAMED_FISH, "fish sauce", "nam pla", "worcestershire", "fish stock"],
    traceTerms: ["dashi", "caesar dressing"],
    exclude: ["fish pepper"],
    skipIf: /\b(vegan|vegetarian|fish free|plant based)\b/,
  },
  {
    allergen: "crustaceans",
    terms: [
      "shrimp",
      "prawn",
      "crab",
      "lobster",
      "crayfish",
      "crawfish",
      "langoustine",
      "scampi",
      "krill",
      "shellfish",
    ],
    traceTerms: ["curry paste"],
    skipIf: /\b(vegan|vegetarian|shellfish free|plant based)\b/,
  },
  {
    allergen: "molluscs",
    terms: [
      "clam",
      "mussel",
      "oyster",
      "scallop",
      "squid",
      "calamari",
      "octopus",
      "cuttlefish",
      "snail",
      "escargot",
      "abalone",
      "whelk",
      "cockle",
      "periwinkle",
      "oyster sauce",
      "shellfish",
    ],
    exclude: ["oyster mushroom", "oyster cracker", "vegetarian oyster sauce"],
    skipIf: /\b(vegan|vegetarian|shellfish free|plant based)\b/,
  },
  {
    allergen: "peanuts",
    terms: ["peanut", "peanut butter", "peanut oil", "groundnut", "ground nut", "monkey nut"],
    skipIf: /\bpeanut free\b/,
  },
  {
    allergen: "nuts",
    terms: [
      "almond",
      "hazelnut",
      "walnut",
      "cashew",
      "pecan",
      "brazil nut",
      "pistachio",
      "macadamia",
      "filbert",
      "marzipan",
      "frangipane",
      "praline",
      "nut",
      "mixed nuts",
      "nut butter",
      "gianduja",
    ],
    traceTerms: ["pesto"],
    exclude: [
      "water chestnut",
      "pine nut",
      "tiger nut",
      "ground nut",
      "monkey nut",
      "coconut",
      "nutmeg",
      "butternut",
      "doughnut",
      "donut",
    ],
    skipIf: /\b(nut free|tree nut free)\b/,
  },
  {
    allergen: "sesame",
    terms: ["sesame", "sesame oil", "sesame seed", "tahini", "tahina", "gomasio", "zaatar", "za atar", "halva", "halvah", "furikake"],
    skipIf: /\bsesame free\b/,
  },
  {
    allergen: "soy",
    terms: [
      "soy",
      "soya",
      "soybean",
      "soy sauce",
      "shoyu",
      "tamari",
      "tofu",
      "miso",
      "edamame",
      "tempeh",
      "soy lecithin",
      "teriyaki",
      "hoisin",
    ],
    skipIf: /\bsoy free\b/,
  },
  {
    allergen: "mustard",
    terms: ["mustard", "dijon", "mustard seed", "mustard powder", "dry mustard"],
  },
  {
    allergen: "celery",
    terms: ["celery", "celeriac", "celery salt", "celery seed", "celery root", "mirepoix"],
    traceTerms: ["stock", "broth", "bouillon", "stock cube"],
  },
  {
    allergen: "sulphites",
    terms: [
      "wine",
      "sherry",
      "vermouth",
      "marsala",
      "champagne",
      "prosecco",
      "dried apricot",
      "dried fruit",
      "golden raisin",
      "sultana",
      "shaoxing",
    ],
    traceTerms: ["cider", "raisin", "dried mango", "dried peach", "dried fig", "dried pear", "molasses"],
  },
  {
    allergen: "lupin",
    terms: ["lupin", "lupine", "lupini"],
  },
];

/** Lowercase, strip diacritics and apostrophes, punctuation to spaces. */
export function normalizeAllergenText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One term to a word-boundary regex source; the last word may be plural. */
function termSource(term: string): string {
  const words = normalizeAllergenText(term).split(" ");
  const last = words.pop() ?? "";
  let lastSource: string;
  if (/[^aeiou]y$/.test(last)) {
    lastSource = `${escapeRegExp(last.slice(0, -1))}(?:y|ies)`;
  } else {
    lastSource = `${escapeRegExp(last)}(?:s|es)?`;
  }
  return [...words.map(escapeRegExp), lastSource].join("\\s+");
}

function compile(terms: string[] | undefined): RegExp | null {
  if (!terms || terms.length === 0) return null;
  // Longest first so "sour cream" wins over "cream" in alternations.
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${sorted.map(termSource).join("|")})\\b`, "g");
}

interface CompiledRule {
  allergen: Eu14Allergen;
  terms: RegExp | null;
  traces: RegExp | null;
  exclude: RegExp | null;
  skipIf?: RegExp;
}

const COMPILED: CompiledRule[] = RULES.map((rule) => ({
  allergen: rule.allergen,
  terms: compile(rule.terms),
  traces: compile(rule.traceTerms),
  exclude: compile(rule.exclude),
  skipIf: rule.skipIf,
}));

function matches(re: RegExp | null, text: string): boolean {
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text);
}

export interface InferredAllergens {
  allergens: Eu14Allergen[];
  traces: Eu14Allergen[];
}

const ORDER = new Map(EU14_ALLERGENS.map((a, i) => [a, i] as const));

function byEuOrder(a: Eu14Allergen, b: Eu14Allergen): number {
  return (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0);
}

/** A note sentence about the ingredient this one replaced, or label checks. */
const DROPPED_SENTENCE =
  /^\s*(?:replaces|replacing|replaced|instead of|in place of|substitutes? for|swapped (?:in )?for|verify on (?:the )?label|check (?:the )?label)\b/i;
/** A note segment offering a different ingredient: "or vegan butter". */
const ALTERNATIVE_START = /^\s*(?:or|alternatively|optionally|substitute|sub|swap)\b/i;
const ALTERNATIVE_MARKER =
  /\b(?:to make (?:it|this|them)|to keep (?:it|this)|for an? [a-z -]*(?:version|option)|if (?:you are |youre |you're |making (?:it )?)?(?:vegan|vegetarian|dairy[ -]free|gluten[ -]free|egg[ -]free|nut[ -]free))\b/i;

export interface SplitNote {
  /** Note text about the ingredient itself. */
  primary: string;
  /** Alternatives the note offers ("or a gluten-free flour blend"). */
  alternatives: string;
}

/**
 * Split an ingredient note into what describes the ingredient and what
 * offers an alternative. Sentences about a replaced ingredient ("Replaces
 * peanut butter ...") and label checks are dropped: they name what is NOT
 * in the dish. Pure.
 */
export function splitAllergenNote(note: string | null | undefined): SplitNote {
  if (!note) return { primary: "", alternatives: "" };
  const primary: string[] = [];
  const alternatives: string[] = [];
  const sentences = note.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (DROPPED_SENTENCE.test(sentence)) continue;
    for (const segment of sentence.split(/[,;()[\]]|\s[-–—]\s/)) {
      if (!segment.trim()) continue;
      if (ALTERNATIVE_START.test(segment) || ALTERNATIVE_MARKER.test(segment)) {
        alternatives.push(segment);
        continue;
      }
      // "softened or melted butter": the part after "or" is the alternative.
      const or = /\b(?:or|alternatively)\b/i.exec(segment);
      if (or) {
        primary.push(segment.slice(0, or.index));
        alternatives.push(segment.slice(or.index + or[0].length));
      } else {
        primary.push(segment);
      }
    }
  }
  return { primary: primary.join(" "), alternatives: alternatives.join(" ") };
}

function inferFromText(text: string, allergens: Set<Eu14Allergen>, traces: Set<Eu14Allergen>): void {
  if (!text) return;
  for (const rule of COMPILED) {
    if (rule.skipIf && rule.skipIf.test(text)) continue;
    // Exclusions scope definite terms only, so "oat flour" is not gluten
    // by "flour" but still a gluten trace by "oat".
    let scoped = text;
    if (rule.exclude) {
      rule.exclude.lastIndex = 0;
      scoped = scoped.replace(rule.exclude, " ");
    }
    if (matches(rule.terms, scoped)) allergens.add(rule.allergen);
    else if (matches(rule.traces, text)) traces.add(rule.allergen);
  }
}

/**
 * Infer EU-14 allergens from an ingredient name and note. Definite matches go
 * to allergens; uncertain ones (oats, stock) go to traces. Qualifiers like
 * "vegan" or "gluten-free" count only for the ingredient itself (name and the
 * note's own description), never from an alternative the note offers. An
 * alternative ("or soy sauce") adds its allergens as traces, since the cook
 * may use it. Sentences about a replaced ingredient are ignored. Pure.
 */
export function inferAllergens(name: string, note?: string | null): InferredAllergens {
  const split = splitAllergenNote(note);
  const primary = normalizeAllergenText(`${name} ${split.primary}`);
  const alternative = normalizeAllergenText(split.alternatives);
  const allergens = new Set<Eu14Allergen>();
  const traces = new Set<Eu14Allergen>();
  inferFromText(primary, allergens, traces);
  const altAllergens = new Set<Eu14Allergen>();
  inferFromText(alternative, altAllergens, traces);
  for (const a of altAllergens) traces.add(a);
  return {
    allergens: [...allergens].sort(byEuOrder),
    traces: [...traces].filter((a) => !allergens.has(a)).sort(byEuOrder),
  };
}

export interface AllergenTagged {
  name: string;
  note?: string | null;
  allergens: Eu14Allergen[];
  allergenTraces: Eu14Allergen[];
}

/**
 * Union the inferred floor into one ingredient's tags. Never removes a tag;
 * new tags append in EU-14 order. Returns the same object when nothing is
 * added. A trace already declared as definite is not added again.
 */
export function withAllergenFloor<T extends AllergenTagged>(ingredient: T): T {
  const inferred = inferAllergens(ingredient.name, ingredient.note);
  const allergens = [...ingredient.allergens];
  for (const a of inferred.allergens) if (!allergens.includes(a)) allergens.push(a);
  const traces = [...ingredient.allergenTraces];
  for (const a of inferred.traces) {
    if (!allergens.includes(a) && !traces.includes(a)) traces.push(a);
  }
  if (
    allergens.length === ingredient.allergens.length &&
    traces.length === ingredient.allergenTraces.length
  ) {
    return ingredient;
  }
  return { ...ingredient, allergens, allergenTraces: traces };
}

/** Floor every ingredient in a list. Pure. */
export function applyAllergenFloor<T extends AllergenTagged>(ingredients: T[]): T[] {
  return ingredients.map((ingredient) => withAllergenFloor(ingredient));
}

/** Union of traces across ingredients that are not already definite, EU order. */
export function rollUpTraces(ingredients: AllergenTagged[]): Eu14Allergen[] {
  const definite = new Set<Eu14Allergen>();
  const traces = new Set<Eu14Allergen>();
  for (const ingredient of ingredients) {
    for (const a of ingredient.allergens) definite.add(a);
    for (const a of ingredient.allergenTraces) traces.add(a);
  }
  return [...traces].filter((a) => !definite.has(a)).sort(byEuOrder);
}

/**
 * Apply the floor to an already-compiled artifact (cached conversions, saved
 * artifacts loaded with ?src=): floors every ingredient and unions the
 * roll-up with what was declared. Never removes a tag. Returns the same
 * object when nothing changes. Client-safe (no Node imports).
 */
export function applyArtifactAllergenFloor(artifact: CookAlongArtifact): CookAlongArtifact {
  const ingredients = applyAllergenFloor(artifact.recipe.ingredients);
  const rolled = new Set<Eu14Allergen>(artifact.recipe.allergens);
  for (const ingredient of ingredients) for (const a of ingredient.allergens) rolled.add(a);
  const unchanged =
    ingredients.every((ing, i) => ing === artifact.recipe.ingredients[i]) &&
    rolled.size === artifact.recipe.allergens.length;
  if (unchanged) return artifact;
  return {
    ...artifact,
    recipe: { ...artifact.recipe, ingredients, allergens: [...rolled].sort() },
  };
}
