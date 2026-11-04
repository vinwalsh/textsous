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
 * moving line, with the stage and elapsed time under it. Motion stops under
 * prefers-reduced-motion (globals.css).
 */
export default function CookingLine({ status }: { status: string }) {
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
        <span role="status" aria-live="polite">
          {status}…
        </span>{" "}
        <span className="cooking-line-time">
          <span className="visually-hidden">Elapsed </span>
          {formatElapsed(elapsed)}
        </span>
      </p>
    </div>
  );
}
