/**
 * The /demo-sites recipe blogs: four original recipes written for this demo
 * (CC0-1.0, no text from any real site) and the three pretend blogs that
 * post them. Pure data and helpers, no Next imports, so scripts/warm-demo.ts
 * and the tests can read it too.
 */

export const DEMO_SITE_LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/";
export const DEMO_SITE_AUTHOR = "TextSous Kitchen";
export const DEMO_SITE_BYLINE = "Recipe written for this TextSous demo";

export type DemoBlogId = "baking" | "weeknights" | "cabin";

export interface DemoBlog {
  id: DemoBlogId;
  /** Fictional, always says "Demo", never the name of a real publication. */
  name: string;
  tagline: string;
}

export const DEMO_BLOGS: Record<DemoBlogId, DemoBlog> = {
  baking: { id: "baking", name: "Demo Batter Club", tagline: "Small-batch baking for slow mornings" },
  weeknights: { id: "weeknights", name: "Demo Weeknights", tagline: "Dinners for busy evenings" },
  cabin: { id: "cabin", name: "Demo Cabin Cooking", tagline: "Cast iron and simple comfort food" },
};

export interface IngredientGroup {
  heading?: string;
  items: readonly string[];
}

export interface DemoSiteRecipe {
  slug: string;
  blog: DemoBlogId;
  /** Which inline SVG the hero draws. */
  art: "muffins" | "sheet-pan" | "skillet" | "chili";
  category: string;
  title: string;
  /** One line for the index and the JSON-LD description. */
  summary: string;
  intro: readonly string[];
  yield: string;
  prepMinutes: number;
  cookMinutes: number;
  totalMinutes: number;
  ingredients: readonly IngredientGroup[];
  steps: readonly string[];
  notes: readonly string[];
}

export const DEMO_SITES: readonly DemoSiteRecipe[] = [
  {
    slug: "lemon-blueberry-muffins",
    blog: "baking",
    art: "muffins",
    category: "Baking",
    title: "Lemon Blueberry Muffins",
    summary:
      "Tall, tender muffins with lemon zest in the batter, plenty of blueberries and a crunchy sugar top. Makes 12.",
    intro: [
      "These are the muffins I bake when the blueberries at the market look too good to walk past. They rise tall and tender, and the sugar on top bakes into a thin, crackly crust.",
      "Rubbing the lemon zest into the sugar before anything else goes in is the one step worth keeping. It takes a minute and makes the whole kitchen smell like lemon.",
      "The batter comes together in two bowls in about fifteen minutes, and the muffins keep well in a covered container for a couple of days.",
    ],
    yield: "12 muffins",
    prepMinutes: 15,
    cookMinutes: 22,
    totalMinutes: 37,
    ingredients: [
      {
        items: [
          "1 and 3/4 cups (219g) all-purpose flour",
          "2 teaspoons baking powder",
          "1/4 teaspoon baking soda",
          "1/2 teaspoon fine salt",
          "3/4 cup (150g) granulated sugar",
          "zest of 2 lemons",
          "1/2 cup (113g) unsalted butter, melted and cooled slightly",
          "2 large eggs, at room temperature",
          "1/2 cup (120g) plain whole-milk yogurt",
          "1/4 cup (60ml) milk",
          "2 tablespoons fresh lemon juice",
          "1 teaspoon vanilla extract",
          "1 and 1/2 cups (225g) fresh blueberries",
          "1 tablespoon all-purpose flour, for the berries",
        ],
      },
      { heading: "For the topping", items: ["2 tablespoons turbinado sugar"] },
    ],
    steps: [
      "Heat the oven to 375°F (190°C). Line a 12-cup muffin tin with paper liners.",
      "In a large bowl, whisk together the 1 and 3/4 cups of flour, the baking powder, baking soda and salt.",
      "In a second bowl, rub the lemon zest into the granulated sugar with your fingertips until it is fragrant and looks like damp sand.",
      "Whisk the melted butter into the lemon sugar, then the eggs one at a time, then the yogurt, milk, lemon juice and vanilla until smooth.",
      "Toss the blueberries with the 1 tablespoon of flour so they don't sink.",
      "Pour the wet ingredients into the dry ones and fold with a spatula until only a few streaks of flour remain. Gently fold in the blueberries. The batter will be thick.",
      "Divide the batter among the muffin cups; they will be quite full. Sprinkle the tops with the turbinado sugar.",
      "Bake for 20 to 22 minutes, until the tops are golden and a toothpick in the center of a muffin comes out clean.",
      "Cool the muffins in the tin for 5 minutes, then move them to a rack.",
    ],
    notes: [
      "Frozen blueberries work too. Add them straight from the freezer, without thawing, and plan on a minute or two more in the oven.",
      "No yogurt? Sour cream works the same way, in the same amount.",
    ],
  },
  {
    slug: "sheet-pan-chicken",
    blog: "weeknights",
    art: "sheet-pan",
    category: "Dinner",
    title: "Sheet-Pan Chicken Thighs with Crispy Potatoes and Herb Yogurt",
    summary:
      "Crisp-skinned chicken thighs and golden potatoes roasted on one pan, with a quick herb yogurt on the side. Serves 4.",
    intro: [
      "This is the dinner I reach for when the week gets away from me. Everything roasts on one pan: chicken thighs on top, potatoes and onion around them, browning in the drippings until the edges turn deep gold.",
      "While it roasts, stir together the herb yogurt. It takes two minutes and makes the plate feel finished.",
      "Use the biggest rimmed sheet pan you have. Crowded potatoes steam instead of crisping, so split everything across two pans if it looks tight.",
    ],
    yield: "4 servings",
    prepMinutes: 15,
    cookMinutes: 45,
    totalMinutes: 60,
    ingredients: [
      {
        items: [
          "8 bone-in, skin-on chicken thighs (about 3 lb / 1.4kg)",
          "1 and 1/2 lb (680g) small yellow potatoes, halved",
          "1 medium red onion, cut into 8 wedges",
          "3 tablespoons olive oil, divided",
          "2 teaspoons kosher salt, divided",
          "1/2 teaspoon black pepper",
          "1 teaspoon smoked paprika",
          "1 teaspoon garlic powder",
          "1 lemon, halved",
        ],
      },
      {
        heading: "For the herb yogurt",
        items: [
          "1 cup (240g) plain Greek yogurt",
          "1/4 cup (10g) chopped fresh herbs, such as dill, parsley and chives",
          "1 small garlic clove, finely grated",
          "1 tablespoon fresh lemon juice",
          "a pinch of salt",
        ],
      },
    ],
    steps: [
      "Heat the oven to 425°F (220°C) with a rack in the middle.",
      "Pat the chicken thighs dry with paper towels. Mix 1 teaspoon of the salt with the pepper, smoked paprika and garlic powder, and rub it all over the chicken.",
      "On a large rimmed sheet pan, toss the potatoes and onion with 2 tablespoons of the olive oil and the remaining 1 teaspoon of salt. Turn the potatoes cut side down.",
      "Nestle the chicken thighs among the potatoes, skin side up. Drizzle the skin with the last tablespoon of olive oil and set the lemon halves cut side down on the pan.",
      "Roast for 40 to 45 minutes, until the skin is crisp and deep golden, the potatoes are browned underneath, and an instant-read thermometer in the thickest thigh reads 175°F (80°C).",
      "While the chicken roasts, stir the yogurt, herbs, garlic, lemon juice and a pinch of salt together in a small bowl.",
      "Let the chicken rest on the pan for 5 minutes. Squeeze the roasted lemon over everything and serve with the herb yogurt.",
    ],
    notes: [
      "Boneless thighs cook faster: roast the potatoes and onion alone for 15 minutes, then add the chicken for the last 20 to 25 minutes.",
      "The herb yogurt keeps in the fridge for up to 2 days.",
    ],
  },
  {
    slug: "skillet-cornbread",
    blog: "cabin",
    art: "skillet",
    category: "Side dish",
    title: "Skillet Cornbread with Honey Butter",
    summary:
      "Golden cast-iron cornbread with crisp edges and a soft middle, served warm with whipped honey butter. Serves 8.",
    intro: [
      "Cornbread baked in a hot cast-iron skillet gets the best edges: crisp, deeply golden and a little buttery. The trick is heating the skillet in the oven first, so the batter sizzles the moment it goes in.",
      "This version leans a little sweet, with honey in the batter and more whipped into the butter you spread on top while it is still warm.",
      "Serve it next to a pot of chili or soup, or on its own with a cup of coffee.",
    ],
    yield: "8 servings",
    prepMinutes: 15,
    cookMinutes: 22,
    totalMinutes: 37,
    ingredients: [
      {
        items: [
          "1 cup (140g) yellow cornmeal",
          "1 cup (125g) all-purpose flour",
          "2 tablespoons granulated sugar",
          "1 tablespoon baking powder",
          "1/2 teaspoon baking soda",
          "3/4 teaspoon fine salt",
          "1 and 1/4 cups (300ml) buttermilk",
          "2 large eggs",
          "2 tablespoons honey",
          "4 tablespoons (57g) unsalted butter, melted",
          "1 tablespoon unsalted butter, for the skillet",
        ],
      },
      {
        heading: "For the honey butter",
        items: ["1/2 cup (113g) salted butter, softened", "3 tablespoons honey", "a pinch of flaky salt"],
      },
    ],
    steps: [
      "Put a 10-inch (25cm) cast-iron skillet on the middle oven rack and heat the oven to 425°F (220°C), so the skillet heats with it.",
      "In a large bowl, whisk together the cornmeal, flour, sugar, baking powder, baking soda and salt.",
      "In another bowl, whisk the buttermilk, eggs, 2 tablespoons of honey and the melted butter until smooth.",
      "Pour the wet ingredients into the dry ones and stir until just combined. A few lumps are fine.",
      "Using oven mitts, take the hot skillet out of the oven. Add the 1 tablespoon of butter and swirl until it melts and coats the bottom and sides, then pour in the batter. It should sizzle.",
      "Bake for 20 to 22 minutes, until the top is golden and a toothpick in the center comes out clean.",
      "While the cornbread bakes, mash the softened butter, 3 tablespoons of honey and the flaky salt together with a fork until fluffy.",
      "Let the cornbread cool in the skillet for 10 minutes, then cut it into 8 wedges and serve warm with the honey butter.",
    ],
    notes: [
      "No buttermilk? Stir 1 tablespoon of lemon juice into 1 and 1/4 cups (300ml) of milk and let it sit for 5 minutes before using.",
      "No cast iron? Bake it in a buttered 9-inch (23cm) square pan without heating the pan first, and start checking at 20 minutes.",
    ],
  },
  {
    slug: "turkey-chili",
    blog: "weeknights",
    art: "chili",
    category: "Dinner",
    title: "Weeknight Turkey and Bean Chili",
    summary:
      "A big pot of turkey and two-bean chili that simmers in about 40 minutes, with a spread of toppings. Serves 6.",
    intro: [
      "This is a chili for a Tuesday: ground turkey, two kinds of beans and a short list of spices, simmered just long enough to taste like it took all afternoon.",
      "Set the toppings out in little bowls and let everyone build their own. The toppings are half the fun.",
      "It reheats well, so one big pot covers lunch for the next couple of days too.",
    ],
    yield: "6 servings",
    prepMinutes: 15,
    cookMinutes: 40,
    totalMinutes: 55,
    ingredients: [
      {
        items: [
          "2 tablespoons olive oil",
          "1 large yellow onion, diced",
          "1 red bell pepper, diced",
          "4 garlic cloves, minced",
          "1 and 1/2 lb (680g) ground turkey",
          "2 tablespoons chili powder",
          "2 teaspoons ground cumin",
          "1 teaspoon dried oregano",
          "1/2 teaspoon smoked paprika",
          "1 and 1/2 teaspoons kosher salt, plus more to taste",
          "2 tablespoons tomato paste",
          "1 can (28 oz / 794g) crushed tomatoes",
          "1 can (15 oz / 425g) kidney beans, drained and rinsed",
          "1 can (15 oz / 425g) black beans, drained and rinsed",
          "1 cup (240ml) chicken broth",
          "1 tablespoon fresh lime juice",
        ],
      },
      {
        heading: "For the toppings",
        items: [
          "1 cup (100g) shredded cheddar",
          "3 green onions, thinly sliced",
          "1/2 cup (120g) sour cream",
          "a handful of fresh cilantro, chopped",
          "tortilla chips, for serving",
        ],
      },
    ],
    steps: [
      "Heat the olive oil in a large Dutch oven or heavy pot over medium heat. Add the onion and bell pepper and cook, stirring now and then, until soft, about 6 minutes.",
      "Add the garlic and cook for 1 minute, until fragrant.",
      "Turn the heat to medium-high and add the turkey. Cook, breaking it up with a spoon, until no pink remains, 6 to 8 minutes.",
      "Stir in the chili powder, cumin, oregano, smoked paprika, salt and tomato paste, and cook for 1 minute, until the spices smell toasty.",
      "Add the crushed tomatoes, both cans of beans and the broth. Bring to a boil, then lower the heat and simmer, partly covered, for 25 minutes, stirring now and then, until thickened.",
      "Stir in the lime juice. Taste, and add more salt if it needs it.",
      "Ladle the chili into bowls and top with the cheddar, green onions, sour cream, cilantro and a few tortilla chips.",
    ],
    notes: [
      "For a thicker chili, mash a ladleful of beans against the side of the pot for the last 10 minutes of simmering.",
      "Leftovers keep in the fridge for up to 4 days and freeze well.",
    ],
  },
];

export const DEMO_SITE_SLUGS: readonly string[] = DEMO_SITES.map((recipe) => recipe.slug);

export function demoSiteBySlug(slug: string): DemoSiteRecipe | null {
  return DEMO_SITES.find((recipe) => recipe.slug === slug) ?? null;
}

export function blogFor(recipe: DemoSiteRecipe): DemoBlog {
  return DEMO_BLOGS[recipe.blog];
}

/** The page's own address, also its canonical link and the URL warm-demo converts. */
export function demoSiteUrl(origin: string, slug: string): string {
  return new URL(`/demo-sites/${slug}`, origin).href;
}

/** Every ingredient line in order, without the group headings. */
export function ingredientLines(recipe: DemoSiteRecipe): string[] {
  return recipe.ingredients.flatMap((group) => [...group.items]);
}

/** ISO 8601 duration for whole minutes: 15 -> PT15M, 60 -> PT1H, 65 -> PT1H5M. */
export function isoDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 || hours === 0 ? `${rest}M` : ""}`;
}

/** Card label: 15 -> "15 min", 60 -> "1 hr", 65 -> "1 hr 5 min". */
export function displayDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} hr` : "", rest > 0 || hours === 0 ? `${rest} min` : ""]
    .filter(Boolean)
    .join(" ");
}

/** schema.org Recipe JSON-LD built from the same data as the card (no nutrition). */
export function demoSiteJsonLd(recipe: DemoSiteRecipe, pageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    url: pageUrl,
    description: recipe.summary,
    author: { "@type": "Organization", name: DEMO_SITE_AUTHOR },
    license: DEMO_SITE_LICENSE,
    recipeCategory: recipe.category,
    recipeYield: recipe.yield,
    prepTime: isoDuration(recipe.prepMinutes),
    cookTime: isoDuration(recipe.cookMinutes),
    totalTime: isoDuration(recipe.totalMinutes),
    recipeIngredient: ingredientLines(recipe),
    recipeInstructions: recipe.steps.map((text) => ({ "@type": "HowToStep", text })),
  };
}
