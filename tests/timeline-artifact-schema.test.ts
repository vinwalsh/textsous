import { describe, expect, it } from "vitest";
import {
  artifactResponseJsonSchema,
  CookAlongArtifactSchema,
} from "../src/lib/schema/artifact";
import { timelineResponseJsonSchema } from "../src/lib/schema/timeline";

function deepStrictness(schema: unknown): { objects: number; violations: string[] } {
  const violations: string[] = [];
  let objects = 0;
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.type === "object" || rec.properties) {
      objects += 1;
      if (rec.additionalProperties !== false) violations.push(`${path}: additionalProperties`);
      const props = Object.keys((rec.properties as object) ?? {});
      const req = (rec.required as string[]) ?? [];
      if (!props.every((p) => req.includes(p))) violations.push(`${path}: required`);
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "required") continue;
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`));
      else walk(v, `${path}.${k}`);
    }
  };
  walk(schema, "$");
  return { objects, violations };
}

function expectEmittedSchema(label: string, schema: Record<string, unknown>): void {
  const text = JSON.stringify(schema);
  expect(text, `${label}: no $ref`).not.toContain("$ref");
  expect(text, `${label}: no $schema`).not.toContain("$schema");
  expect(text, `${label}: no const`).not.toContain('"const"');
  const { objects, violations } = deepStrictness(schema);
  expect(objects, `${label}: nested objects exist`).toBeGreaterThan(3);
  expect(violations, `${label}: every object strict and fully required`).toEqual([]);
}

const MIN_TASK = {
  id: "task-1",
  phase: "prep",
  label: "Chop the onions",
  cardTitle: { action: "Chop", subject: "onions", context: "for the sauce" },
  description: "Dice two onions.",
  completionCue: "Onions are in an even dice.",
  minutes: 5,
  range: null,
  timingBasis: "estimate",
  sourceQuote: null,
  attention: "hands-on",
  timerEnabledByDefault: false,
  laneIds: ["lane-sauce"],
  dependencies: [],
  sourceStepIds: ["step-1"],
  checkpoints: [],
  tip: null,
  equipmentEvent: null,
  scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
};

const MIN_TIMELINE = {
  lanes: [
    { id: "lane-sauce", label: "Sauce", color: "red", kind: "component" },
    { id: "lane-kitchen", label: "Kitchen", color: "gray", kind: "kitchen" },
  ],
  tasks: [MIN_TASK],
  resources: [],
  resourceHolds: [],
  serveTaskId: "task-1",
};

const MIN_ARTIFACT = {
  formatVersion: 1,
  id: "art-1",
  recipe: {
    title: "Toast",
    servings: 2,
    ingredients: [
      {
        id: "ing-1",
        name: "bread",
        quantity: "1",
        unit: "slice",
        quantity4: null,
        scaleRule: null,
        allergens: [],
        allergenTraces: [],
        note: null,
      },
    ],
    equipment: [],
    steps: [{ id: "step-1", kind: "active", text: "Toast the bread." }],
    allergens: [],
    originalMethod: "toasted",
    methodLabel: "Toasted",
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
  timelineDefinition: MIN_TIMELINE,
  equipmentProfile: { burners: 4, oven: true },
  changes: [],
};

describe("timeline and artifact response JSON schemas", () => {
  it("emits a strict, fully required timeline schema", () => {
    expectEmittedSchema("timeline", timelineResponseJsonSchema());
  });

  it("emits a strict, fully required artifact schema", () => {
    expectEmittedSchema("artifact", artifactResponseJsonSchema());
  });

  it("accepts a minimal valid artifact", () => {
    const parsed = CookAlongArtifactSchema.safeParse(MIN_ARTIFACT);
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys and bad enums", () => {
    const extraKey = structuredClone(MIN_ARTIFACT) as Record<string, unknown>;
    extraKey.calories = 100;
    expect(CookAlongArtifactSchema.safeParse(extraKey).success).toBe(false);
    const badPhase = structuredClone(MIN_TIMELINE) as {
      tasks: Array<Record<string, unknown>>;
    };
    badPhase.tasks[0].phase = "brunch";
    const badArtifact = { ...MIN_ARTIFACT, timelineDefinition: badPhase };
    expect(CookAlongArtifactSchema.safeParse(badArtifact).success).toBe(false);
  });
});
