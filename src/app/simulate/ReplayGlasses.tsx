"use client";

import { useMemo } from "react";
import GlassesApp from "../glasses/GlassesApp";
import { muffinsArtifact } from "./recordings";
import { SIMULATION_NOTE } from "./replay";

/**
 * /simulate/glasses: the real heads-up view on the finished muffins cook
 * along, its guide clock running `speed` times faster. Timers stay on real
 * time, and nothing is saved between visits.
 */
export default function ReplayGlasses({ speed }: { speed: number }) {
  const artifact = useMemo(() => muffinsArtifact(), []);
  return (
    <GlassesApp
      demos={[]}
      artifact={artifact}
      clockMultiplier={speed}
      banner={
        <p className="g-replay" role="note">
          {SIMULATION_NOTE} · Guide clock ×{speed} · Timers run in real time ·{" "}
          <a href="/simulate">All simulations</a>
        </p>
      }
    />
  );
}
