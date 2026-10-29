import { describe, expect, it } from "vitest";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import type { VariantTransform } from "../src/lib/schema/variant";
import { applyVariant } from "../src/lib/variant-apply";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-test",
    recipe: {
      title: "Test Soup",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "milk",
          quantity: "1",
          unit: "cup",
          quantity4: null,
          scaleRule: null,
          allergens: ["milk"],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
        {
          id: "ing-2",
          name: "flour",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          allergens: ["gluten"],
          allergenTraces: [],
          note: null,
          cookQuantity: null,
          buyQuantity: null,
        },
      ],
      equipment: [],
      steps: [
        { id: "step-1", kind: "active", text: "Add the milk." },
        { id: "step-2", kind: "active", text: "Bake 30 minutes." },
      ],
      allergens: ["gluten", "milk"],
      originalMethod: "bake",
      methodLabel: "Baked",
      methodNotice: "",
      credit: {
        kind: "text",
        site: null,
        author: null,
        url: null,
        book: null,
        page: null,
        license: null,
      },
    },
    timelineDefinition: {
      lanes: [],
      tasks: [],
      resources: [],
      resourceHolds: [],
      serveTaskId: "task-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

function makeTransform(overrides: Partial<VariantTransform> = {}): VariantTransform {
  return {
    kind: "dietary",
    target: "dairy-free",
    titleOverride: null,
    swaps: [],
    stepOverrides: [],
    techniqueChanges: [],
    rationale: [],
    ...overrides,
  };
}

describe("applyVariant", () => {
  it("applies swaps in place with unknown allergens and label notes", () => {
    const { artifact, removedNames } = applyVariant(
      makeArtifact(),
      makeTransform({
        swaps: [
          {
            fromIngredientId: "ing-1",
            to: { name: "oat milk", quantity: "1", unit: "cup" },
            omitReason: null,
            reason: "closest match",
            packageRequirements: ["certified dairy-free"],
          },
        ],
      }),
    );
    const swapped = artifact.recipe.ingredients.find((i) => i.id === "ing-1");
    expect(swapped?.name).toBe("oat milk");
    expect(swapped?.allergens).toEqual([]);
    expect(swapped?.note).toContain("Replaces milk");
    expect(swapped?.note).toContain("Verify on label: certified dairy-free");
    expect(artifact.recipe.allergens).toEqual(["gluten"]);
    expect(removedNames).toContain("milk");
    expect(artifact.changes).toContainEqual({
      kind: "swap",
      detail: "milk → oat milk (dairy-free): closest match",
    });
  });

  it("omits ingredients and drops their allergens", () => {
    const { artifact } = applyVariant(
      makeArtifact(),
      makeTransform({
        swaps: [
          {
            fromIngredientId: "ing-2",
            to: null,
            omitReason: "not needed",
            reason: "optional thickener",
            packageRequirements: [],
          },
        ],
      }),
    );
    expect(artifact.recipe.ingredients.map((i) => i.id)).toEqual(["ing-1"]);
    expect(artifact.recipe.allergens).toEqual(["milk"]);
  });

  it("throws on unknown ingredient and step references", () => {
    expect(() =>
      applyVariant(
        makeArtifact(),
        makeTransform({
          swaps: [
            {
              fromIngredientId: "ing-9",
              to: null,
              omitReason: null,
              reason: "x",
              packageRequirements: [],
            },
          ],
        }),
      ),
    ).toThrow(/unknown ingredient "ing-9"/);
    expect(() =>
      applyVariant(
        makeArtifact(),
        makeTransform({ stepOverrides: [{ stepId: "step-9", text: "Stir." }] }),
      ),
    ).toThrow(/unknown step "step-9"/);
  });

  it("refuses swaps that reintroduce earlier-removed ingredients", () => {
    expect(() =>
      applyVariant(makeArtifact(), makeTransform(), { forbiddenNames: ["oat milk"] }),
    ).not.toThrow();
    expect(() =>
      applyVariant(
        makeArtifact(),
        makeTransform({
          kind: "cuisine",
          target: "Italian",
          swaps: [
            {
              fromIngredientId: "ing-1",
              to: { name: "Milk", quantity: "1", unit: "cup" },
              omitReason: null,
              reason: "x",
              packageRequirements: [],
            },
          ],
        }),
        { forbiddenNames: ["milk"] },
      ),
    ).toThrow(/reintroduces an ingredient removed by an earlier variant/);
  });

  it("refuses step overrides that change timings but allows untimed rewording", () => {
    expect(() =>
      applyVariant(
        makeArtifact(),
        makeTransform({
          stepOverrides: [{ stepId: "step-2", text: "Bake 45 minutes." }],
        }),
      ),
    ).toThrow(/changes timings/);
    const { artifact } = applyVariant(
      makeArtifact(),
      makeTransform({
        stepOverrides: [{ stepId: "step-1", text: "Add 2 cups milk." }],
      }),
    );
    expect(artifact.recipe.steps[0].text).toContain("2 cups milk");
  });

  it("records technique changes and title overrides", () => {
    const { artifact } = applyVariant(
      makeArtifact(),
      makeTransform({
        titleOverride: "New Name",
        techniqueChanges: ["Finish under the broiler."],
      }),
    );
    expect(artifact.recipe.title).toBe("New Name");
    expect(artifact.changes).toContainEqual({
      kind: "technique",
      detail: "Finish under the broiler.",
    });
  });

  it("updates the method label and notice only on real method changes", () => {
    const changed = applyVariant(
      makeArtifact(),
      makeTransform({
        stepOverrides: [
          { stepId: "step-1", text: "Add the milk and grill briefly." },
          { stepId: "step-2", text: "Grill 30 minutes." },
        ],
      }),
    );
    expect(changed.artifact.recipe.originalMethod).toBe("bake");
    expect(changed.artifact.recipe.methodLabel).toBe("Grilled");
    expect(changed.artifact.recipe.methodNotice).toContain("Baked to Grilled");
    const same = applyVariant(
      makeArtifact(),
      makeTransform({
        stepOverrides: [{ stepId: "step-2", text: "Bake 30 minutes until firm." }],
      }),
    );
    expect(same.artifact.recipe.methodLabel).toBe("Baked");
    expect(same.artifact.recipe.methodNotice).toBe("");
  });

  it("rejects unknown dietary targets", () => {
    expect(() => applyVariant(makeArtifact(), makeTransform({ target: "keto" }))).toThrow(
      /unknown dietary target/,
    );
  });
});
