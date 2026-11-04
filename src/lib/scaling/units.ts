export type UnitKind = "volume" | "weight" | "count" | "other";

export interface UnitInfo {
  standard: string;
  kind: UnitKind;
}

const ENTRIES: Array<[string, UnitInfo]> = [
  ["cup", { standard: "cup", kind: "volume" }],
  ["cups", { standard: "cup", kind: "volume" }],
  ["tbsp", { standard: "tbsp", kind: "volume" }],
  ["tablespoon", { standard: "tbsp", kind: "volume" }],
  ["tablespoons", { standard: "tbsp", kind: "volume" }],
  ["tsp", { standard: "tsp", kind: "volume" }],
  ["teaspoon", { standard: "tsp", kind: "volume" }],
  ["teaspoons", { standard: "tsp", kind: "volume" }],
  ["ml", { standard: "ml", kind: "volume" }],
  ["milliliter", { standard: "ml", kind: "volume" }],
  ["milliliters", { standard: "ml", kind: "volume" }],
  ["millilitre", { standard: "ml", kind: "volume" }],
  ["millilitres", { standard: "ml", kind: "volume" }],
  ["l", { standard: "l", kind: "volume" }],
  ["liter", { standard: "l", kind: "volume" }],
  ["liters", { standard: "l", kind: "volume" }],
  ["litre", { standard: "l", kind: "volume" }],
  ["litres", { standard: "l", kind: "volume" }],
  ["g", { standard: "g", kind: "weight" }],
  ["gram", { standard: "g", kind: "weight" }],
  ["grams", { standard: "g", kind: "weight" }],
  ["gramme", { standard: "g", kind: "weight" }],
  ["grammes", { standard: "g", kind: "weight" }],
  ["gr", { standard: "g", kind: "weight" }],
  ["kg", { standard: "kg", kind: "weight" }],
  ["kilogram", { standard: "kg", kind: "weight" }],
  ["kilograms", { standard: "kg", kind: "weight" }],
  ["kgs", { standard: "kg", kind: "weight" }],
  ["kilo", { standard: "kg", kind: "weight" }],
  ["kilos", { standard: "kg", kind: "weight" }],
  ["oz", { standard: "oz", kind: "weight" }],
  ["ounce", { standard: "oz", kind: "weight" }],
  ["ounces", { standard: "oz", kind: "weight" }],
  ["lb", { standard: "lb", kind: "weight" }],
  ["lbs", { standard: "lb", kind: "weight" }],
  ["pound", { standard: "lb", kind: "weight" }],
  ["pounds", { standard: "lb", kind: "weight" }],
  ["each", { standard: "each", kind: "count" }],
  ["ea", { standard: "each", kind: "count" }],
  ["slice", { standard: "slice", kind: "count" }],
  ["slices", { standard: "slice", kind: "count" }],
  ["clove", { standard: "clove", kind: "count" }],
  ["cloves", { standard: "clove", kind: "count" }],
  ["can", { standard: "can", kind: "count" }],
  ["cans", { standard: "can", kind: "count" }],
  ["stalk", { standard: "stalk", kind: "count" }],
  ["stalks", { standard: "stalk", kind: "count" }],
  ["piece", { standard: "piece", kind: "count" }],
  ["pieces", { standard: "piece", kind: "count" }],
  // Containers: bought whole, so buy amounts round up to whole items.
  ["jar", { standard: "jar", kind: "count" }],
  ["jars", { standard: "jar", kind: "count" }],
  ["package", { standard: "package", kind: "count" }],
  ["packages", { standard: "package", kind: "count" }],
  ["packet", { standard: "packet", kind: "count" }],
  ["packets", { standard: "packet", kind: "count" }],
  ["box", { standard: "box", kind: "count" }],
  ["boxes", { standard: "box", kind: "count" }],
  ["bag", { standard: "bag", kind: "count" }],
  ["bags", { standard: "bag", kind: "count" }],
  ["bottle", { standard: "bottle", kind: "count" }],
  ["bottles", { standard: "bottle", kind: "count" }],
  ["carton", { standard: "carton", kind: "count" }],
  ["cartons", { standard: "carton", kind: "count" }],
  ["tin", { standard: "tin", kind: "count" }],
  ["tins", { standard: "tin", kind: "count" }],
  ["stick", { standard: "stick", kind: "count" }],
  ["sticks", { standard: "stick", kind: "count" }],
  ["pinch", { standard: "pinch", kind: "other" }],
  ["pinches", { standard: "pinch", kind: "other" }],
  ["dash", { standard: "dash", kind: "other" }],
  ["dashes", { standard: "dash", kind: "other" }],
];

export const UNIT_TABLE: Record<string, UnitInfo> = Object.fromEntries(ENTRIES);

/** Look up a unit alias (case-insensitive, trailing periods ignored). */
export function lookupUnit(raw: string): UnitInfo | null {
  const key = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (!key) return null;
  return UNIT_TABLE[key] ?? null;
}

/** Countable units (eggs, slices, cans) round up to whole items when buying. */
export function isCountable(raw: string): boolean {
  return lookupUnit(raw)?.kind === "count";
}

/** Metric units, whose scaled amounts round to whole g and ml, tenths of kg and l. */
const METRIC_STEPS: Record<string, number> = { g: 1, ml: 1, kg: 0.1, l: 0.1 };

/** The rounding step for a metric unit ("grams" -> 1, "kg" -> 0.1), else null. */
export function metricStep(raw: string): number | null {
  const info = lookupUnit(raw);
  return info ? (METRIC_STEPS[info.standard] ?? null) : null;
}

/** Weights and volumes (cups, grams, ounces), not counts or pinches. */
export function isMeasureUnit(raw: string): boolean {
  const kind = lookupUnit(raw)?.kind;
  return kind === "volume" || kind === "weight";
}
