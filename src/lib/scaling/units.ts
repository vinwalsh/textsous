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
  ["l", { standard: "l", kind: "volume" }],
  ["liter", { standard: "l", kind: "volume" }],
  ["liters", { standard: "l", kind: "volume" }],
  ["g", { standard: "g", kind: "weight" }],
  ["gram", { standard: "g", kind: "weight" }],
  ["grams", { standard: "g", kind: "weight" }],
  ["kg", { standard: "kg", kind: "weight" }],
  ["kilogram", { standard: "kg", kind: "weight" }],
  ["kilograms", { standard: "kg", kind: "weight" }],
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
