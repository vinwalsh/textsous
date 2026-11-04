/** Shared cards declare ordered, adjacent lane membership. Reorder columns,
 * never those task memberships: the first lane is also the scheduler's primary
 * lane, so sorting each task's IDs could change coverage and task meaning. */
type Lane = { id: string; kind: "component" | "kitchen" };
type SharedTask = { id: string; laneIds: readonly string[] };
type LaneOrderResult<T> = { ok: true; lanes: T[] } | { ok: false; message: string };
type NeighborRequirement = { left: string; right: string; tasks: SharedTask[] };

export function orderSharedCookingLanes<T extends Lane>(lanes: readonly T[], tasks: readonly SharedTask[]): LaneOrderResult<T> {
  const byId = new Map(lanes.map(lane => [lane.id, lane]));
  const kitchens = lanes.filter(lane => lane.kind === "kitchen");
  if (!lanes.length || lanes.length > 41 || tasks.length > 100 || byId.size !== lanes.length || kitchens.length !== 1) {
    return { ok: false, message: "Lane ordering requires unique lanes and exactly one kitchen lane." };
  }
  const kitchenId = kitchens[0].id;
  const next = new Map<string, string>(), previous = new Map<string, string>();
  const outgoing = new Map<string, Map<string, NeighborRequirement>>();
  const incoming = new Map<string, Map<string, NeighborRequirement>>();
  for (const task of tasks) {
    if (!task.laneIds.length || new Set(task.laneIds).size !== task.laneIds.length || task.laneIds.some(id => !byId.has(id))) {
      return { ok: false, message: `Task ${task.id} has missing, repeated or unknown lane membership.` };
    }
    for (let index = 1; index < task.laneIds.length; index++) {
      const left = task.laneIds[index - 1], right = task.laneIds[index];
      const after = outgoing.get(left) ?? new Map<string, NeighborRequirement>();
      const before = incoming.get(right) ?? new Map<string, NeighborRequirement>();
      const requirement = after.get(right) ?? { left, right, tasks: [] };
      requirement.tasks.push(task);
      after.set(right, requirement); before.set(left, requirement);
      outgoing.set(left, after); incoming.set(right, before);
      next.set(left, right); previous.set(right, left);
    }
  }
  const explain = (summary: string, requirements: NeighborRequirement[]): LaneOrderResult<T> => {
    const involved = [...new Set(requirements.flatMap(requirement => requirement.tasks))];
    const edges = requirements.slice(0, 12).map(requirement => `${JSON.stringify(requirement.left)} immediately before ${JSON.stringify(requirement.right)} required by tasks ${JSON.stringify(requirement.tasks.slice(0, 12).map(task => task.id))}${requirement.tasks.length > 12 ? " (additional tasks omitted)" : ""}`);
    const memberships = involved.slice(0, 12).map(task => `Task ${task.id}: laneIds=${JSON.stringify(task.laneIds)}, primary=${JSON.stringify(task.laneIds[0])}.`);
    const details = `${edges.join("; ")}. ${memberships.join(" ")}`;
    return { ok: false, message: `${summary.slice(0, 1000)} The kitchen lane ${JSON.stringify(kitchenId)} must be last. Every task's laneIds is an ORDERED, contiguous membership; its first entry is the scheduler's primary lane. Column reordering cannot change these memberships. Correct the conflicting authored memberships using the task's actual work; do not sort laneIds, add unrelated lanes or silently change the primary lane. ${details.slice(0, 9000)}${summary.length > 1000 || details.length > 9000 || requirements.length > 12 || involved.length > 12 ? " Additional diagnostic detail omitted." : ""}` };
  };
  const conflicts: string[] = [], conflictingRequirements = new Set<NeighborRequirement>();
  const afterKitchen = outgoing.get(kitchenId);
  if (afterKitchen?.size) {
    conflicts.push(`Tasks place another lane after kitchen ${JSON.stringify(kitchenId)}.`);
    for (const requirement of afterKitchen.values()) conflictingRequirements.add(requirement);
  }
  for (const [left, requirements] of outgoing) if (requirements.size > 1) {
    conflicts.push(`Lane ${JSON.stringify(left)} requires incompatible immediate successors ${JSON.stringify([...requirements.keys()])}.`);
    for (const requirement of requirements.values()) conflictingRequirements.add(requirement);
  }
  for (const [right, requirements] of incoming) if (requirements.size > 1) {
    conflicts.push(`Lane ${JSON.stringify(right)} requires incompatible immediate predecessors ${JSON.stringify([...requirements.keys()])}.`);
    for (const requirement of requirements.values()) conflictingRequirements.add(requirement);
  }
  if (conflicts.length) return explain(conflicts.slice(0, 8).join(" "), [...conflictingRequirements]);
  const positions = new Map(lanes.map((lane, index) => [lane.id, index]));
  if (lanes.at(-1)?.id === kitchenId && [...next].every(([left, right]) => positions.get(right)! === positions.get(left)! + 1)) {
    return { ok: true, lanes: [...lanes] };
  }
  // Each lane has at most one immediate neighbor on either side, so valid
  // constraints form disjoint chains. This is bounded linear work, not a
  // factorial permutation search. Retain authored order between free chains.
  const visited = new Set<string>(), chains: T[][] = [];
  for (const lane of lanes) {
    if (previous.has(lane.id)) continue;
    const chain: T[] = [];
    let current: string | undefined = lane.id;
    while (current !== undefined && !visited.has(current)) {
      chain.push(byId.get(current)!); visited.add(current); current = next.get(current);
    }
    chains.push(chain);
  }
  if (visited.size !== lanes.length) return explain("Shared-task lane ordering contains a cycle; no column order preserves these memberships.",
    [...outgoing.values()].flatMap(requirements => [...requirements.values()]).filter(requirement => !visited.has(requirement.left)));
  const kitchenChain = chains.find(chain => chain.at(-1)?.id === kitchenId)!;
  return { ok: true, lanes: [...chains.filter(chain => chain !== kitchenChain).flat(), ...kitchenChain] };
}
