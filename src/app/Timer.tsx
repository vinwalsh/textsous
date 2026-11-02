"use client";

import { useEffect, useRef, useState } from "react";

function format(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Shift a countdown by delta seconds, never below zero. Pure. */
export function adjustRemaining(remaining: number, deltaSeconds: number): number {
  return Math.max(0, remaining + deltaSeconds);
}

/** Step countdown. Timestamp-based so a paused tab does not drift. */
export default function Timer({ minutes, label }: { minutes: number; label: string }) {
  const total = Math.max(1, Math.round(minutes * 60));
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const remainingRef = useRef(total);
  const endAtRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    endAtRef.current = Date.now() + remainingRef.current * 1000;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      remainingRef.current = left;
      setRemaining(left);
      if (left <= 0) setRunning(false);
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  function reset() {
    setRunning(false);
    remainingRef.current = total;
    setRemaining(total);
  }

  function adjust(deltaSeconds: number) {
    if (running) endAtRef.current += deltaSeconds * 1000;
    const next = adjustRemaining(remainingRef.current, deltaSeconds);
    remainingRef.current = next;
    setRemaining(next);
    if (next <= 0) setRunning(false);
  }

  const done = remaining <= 0;
  return (
    <div className="timer" aria-label={`Timer for ${label}`}>
      <span className="timer-digits" aria-live="polite">
        {done ? "Done" : format(remaining)}
      </span>
      {!done ? (
        <>
          <button type="button" className="btn" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Start"}
          </button>
          <button type="button" className="btn" onClick={reset}>
            Reset
          </button>
          <button type="button" className="btn" aria-label="One minute less" onClick={() => adjust(-60)}>
            −1 min
          </button>
          <button type="button" className="btn" aria-label="One minute more" onClick={() => adjust(60)}>
            +1 min
          </button>
        </>
      ) : (
        <button type="button" className="btn" onClick={reset}>
          Restart
        </button>
      )}
    </div>
  );
}
