"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { formatElapsed } from "./ProgressNote";

function ChefHat() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path
        d="M7 15.5c-2.6-.3-4-2.2-3.5-4.3.4-1.8 2.2-2.8 3.9-2.4.4-2.1 2.4-3.6 4.6-3.6s4.2 1.5 4.6 3.6c1.7-.4 3.5.6 3.9 2.4.5 2.1-.9 4-3.5 4.3V19H7z"
        fill="#FFFFFF"
        stroke="#22201C"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7 16.6h10" stroke="#22201C" strokeWidth="1.4" />
    </svg>
  );
}

function Table() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M8.5 9.5a3.5 3.5 0 0 1 7 0z" fill="#D45A35" />
      <path d="M12 5.2v.8" stroke="#22201C" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M3 11h18M5.5 11l-1 8M18.5 11l1 8M8 14h8"
        stroke="#8A5A2B"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Chopping, mixing, cooking, the cook, plating, the meal, the table: left to right. */
const ICONS: ReadonlyArray<{ key: string; icon: ReactNode }> = [
  { key: "carrot", icon: "🥕" },
  { key: "knife", icon: "🔪" },
  { key: "bowl", icon: "🥣" },
  { key: "pan", icon: "🍳" },
  { key: "cook", icon: "🧑‍🍳" },
  { key: "hat", icon: <ChefHat /> },
  { key: "plate", icon: "🍽️" },
  { key: "meal", icon: "🥘" },
  { key: "table", icon: <Table /> },
];

/**
 * One line of cooking icons that take turns, left to right, over a thin
 * moving line, with the stage and elapsed time under it. It sticks to the
 * top of the screen while the page scrolls (globals.css), so the reader
 * always sees that the cook along is still being written. Motion stops under
 * prefers-reduced-motion. The stage is a polite live region (milestones
 * only, never the clock) unless `live` is false.
 */
export default function CookingLine({ status, live = true }: { status: string; live?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="cooking-line">
      <ul className="cooking-line-icons" aria-hidden="true">
        {ICONS.map(({ key, icon }, i) => (
          <li key={key} className="cooking-line-icon" style={{ "--ts-turn": i } as CSSProperties}>
            {icon}
          </li>
        ))}
      </ul>
      <div className="cooking-line-track" aria-hidden="true">
        <span className="cooking-line-runner" />
      </div>
      <p className="cooking-line-status">
        {live ? (
          <span role="status" aria-live="polite">
            {status}…
          </span>
        ) : (
          <span>{status}…</span>
        )}{" "}
        <span className="cooking-line-time">
          <span className="visually-hidden">Elapsed </span>
          {formatElapsed(elapsed)}
        </span>
      </p>
    </div>
  );
}

/** How long the top line says the cook along is ready before it goes. */
export const READY_MS = 2600;

/**
 * The top line on the finished page. While an adjustment applies it is the
 * cooking line with "Adjusting…"; then "Your Cook Along is ready" for a
 * moment; then nothing. `built`: the cook along was just written on this
 * page, so it opens with Ready. Screen readers hear each milestone once, from
 * a live region that exists before its words change.
 */
export function FinishLine({ adjusting, built = false }: { adjusting: boolean; built?: boolean }) {
  const [phase, setPhase] = useState<"ready" | "hidden">(built ? "ready" : "hidden");
  const [wasAdjusting, setWasAdjusting] = useState(adjusting);
  if (adjusting !== wasAdjusting) {
    // An adjustment just finished: say Ready again.
    setWasAdjusting(adjusting);
    if (!adjusting) setPhase("ready");
  }
  useEffect(() => {
    if (adjusting || phase !== "ready") return;
    const id = setTimeout(() => setPhase("hidden"), READY_MS);
    return () => clearTimeout(id);
  }, [adjusting, phase]);

  const message = adjusting ? "Adjusting your Cook Along." : phase === "ready" ? "Your Cook Along is ready." : "";
  const [said, setSaid] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSaid(message), 100);
    return () => clearTimeout(id);
  }, [message]);

  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite">
        {said}
      </p>
      {adjusting ? (
        <CookingLine status="Adjusting" live={false} />
      ) : phase === "ready" ? (
        <div className="cooking-line cooking-line-ready">
          <p className="cooking-line-status">
            <span className="cooking-line-check" aria-hidden="true">
              ✓
            </span>
            Your Cook Along is ready
          </p>
        </div>
      ) : null}
    </>
  );
}
