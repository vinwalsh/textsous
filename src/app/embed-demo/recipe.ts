/**
 * The demo blog post's recipe: eval/fixtures/toasted-oat-porridge.html, an
 * original recipe written for this project (CC0-1.0). tests/embed-demo.test.ts
 * checks that every line here still matches the fixture.
 */
export const DEMO_FIXTURE = "eval/fixtures/toasted-oat-porridge.html";

export const DEMO_RECIPE = {
  title: "Toasted Oat Porridge with Brown Butter Apples",
  author: "TextSous Kitchen",
  intro: "A cozy two-serving breakfast of toasted oats under brown butter apples.",
  yield: "2 servings",
  license: "https://creativecommons.org/publicdomain/zero/1.0/",
  ingredients: [
    "1 cup rolled oats",
    "2 cups whole milk",
    "1 tablespoon unsalted butter",
    "1 medium apple, diced",
    "2 tablespoons brown sugar",
    "1/4 teaspoon ground cinnamon",
    "1 pinch fine sea salt",
  ],
  sections: [
    {
      name: null,
      steps: [
        "Toast the rolled oats in a dry saucepan over medium heat for 2 minutes, until fragrant.",
      ],
    },
    {
      name: "Apples",
      steps: [
        "Melt the butter in a small skillet until it foams and smells nutty.",
        "Add the diced apple, brown sugar, and cinnamon; cook 5 minutes until soft.",
      ],
    },
    {
      name: null,
      steps: [
        "Pour the milk over the oats, add the salt, and simmer 6 minutes, stirring often.",
        "Spoon into bowls and top with the brown butter apples.",
      ],
    },
  ],
} as const;

/** schema.org Recipe JSON-LD for the demo post (no invented times or nutrition). */
export function demoJsonLd(pageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: DEMO_RECIPE.title,
    url: pageUrl,
    description: DEMO_RECIPE.intro,
    author: { "@type": "Person", name: DEMO_RECIPE.author },
    license: DEMO_RECIPE.license,
    recipeYield: DEMO_RECIPE.yield,
    recipeIngredient: [...DEMO_RECIPE.ingredients],
    recipeInstructions: DEMO_RECIPE.sections.map((section) =>
      section.name
        ? {
            "@type": "HowToSection",
            name: section.name,
            itemListElement: section.steps.map((text) => ({ "@type": "HowToStep", text })),
          }
        : section.steps.length === 1
          ? { "@type": "HowToStep", text: section.steps[0] }
          : section.steps.map((text) => ({ "@type": "HowToStep", text })),
    ).flat(),
  };
}
