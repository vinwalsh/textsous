/**
 * Lane colors of the TextSous Cook Along look: muted earth tones for the
 * component lanes, in order, and one warm grey for the kitchen lane.
 *
 * New lanes get these colors where code picks a default (the skills API).
 * The viewer colors every lane by its position with the same palette,
 * whatever color the artifact stored, so cached and new conversions look
 * the same. Stored artifacts are never rewritten. Pure, no Next imports.
 */
export const LANE_PALETTE = ["#B58D3D", "#587454", "#B94C39", "#477653", "#8A6F9E", "#3F7A8C"] as const;

export const KITCHEN_LANE_COLOR = "#AAA398";

/** Default color for the nth component lane (0-based), wrapping after six. */
export function componentLaneColor(index: number): string {
  const i = Number.isInteger(index) && index > 0 ? index : 0;
  return LANE_PALETTE[i % LANE_PALETTE.length];
}

/**
 * Display color per lane id: component lanes in order take the palette in
 * turn, kitchen lanes take the kitchen grey. A repeated id keeps its first
 * color.
 */
export function laneDisplayColors(
  lanes: ReadonlyArray<{ id: string; kind: string }>,
): Map<string, string> {
  const colors = new Map<string, string>();
  let component = 0;
  for (const lane of lanes) {
    if (colors.has(lane.id)) continue;
    if (lane.kind === "kitchen") {
      colors.set(lane.id, KITCHEN_LANE_COLOR);
    } else {
      colors.set(lane.id, componentLaneColor(component));
      component += 1;
    }
  }
  return colors;
}

/** A task's color: its first lane's display color, the kitchen grey when unknown. */
export function taskLaneColor(colors: ReadonlyMap<string, string>, laneIds: readonly string[]): string {
  return colors.get(laneIds[0] ?? "") ?? KITCHEN_LANE_COLOR;
}
