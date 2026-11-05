import type { Metadata } from "next";
import Link from "next/link";
import { SIMULATION_NOTE } from "./replay";

export const metadata: Metadata = {
  title: "Simulations · TextSous Open",
  description: "Real conversions recorded on Nov 4, 2026, replayed through the live pages' components at any speed.",
  robots: { index: false, follow: false },
};

/** The simulations for the demo video: recordings replayed, nothing live. */
export default function SimulatePage() {
  return (
    <main>
      <h1>Simulations</h1>
      <p className="tagline">
        Real conversions of our own recipes, recorded on production on Nov 4, 2026 and replayed
        through the same components as the live pages, at any speed: the build-up of a Cook Along and
        the glasses guide without the wait.
      </p>
      <p className="notice" role="note">
        {SIMULATION_NOTE}. Nothing on these pages calls the model or applies adjustments; the live
        pages do.
      </p>
      <ul className="sim-list">
        <li className="card">
          <h2>
            <Link href="/simulate/convert?speed=4">A recipe page becomes a Cook Along</Link>
          </h2>
          <p className="meta">
            Lemon Blueberry Muffins from the demo blog: facts at 0.2 s, the summary at 4 s, the
            ingredients at 24 s, prep and steps at 48 s, done at 1:14. Replay ×4 by default; Play,
            Pause, the speeds and Restart sit on the bar.
          </p>
        </li>
        <li className="card">
          <h2>
            <Link href="/simulate/glasses?speed=20">The glasses guide, twenty times faster</Link>
          </h2>
          <p className="meta">
            The heads-up Cook Along on the finished muffins, its guide clock running ×20 so every
            step comes due in seconds. Timers stay on real time.
          </p>
        </li>
        <li className="card">
          <h2>
            <Link href="/simulate/photo?speed=4">Two cookbook photos become a Cook Along</Link>
          </h2>
          <p className="meta">
            Skillet Cornbread with Honey Butter from two photographed pages: the transcription (about
            20 s), the confirm screen, then the recorded conversion (46 s) and the finished Cook
            Along.
          </p>
        </li>
      </ul>
      <p className="meta">
        <Link href="/demo">Demo recipes</Link> · <Link href="/cook-along-demo">A finished Cook Along</Link> ·{" "}
        <Link href="/">Convert your own recipe</Link>
      </p>
    </main>
  );
}
