"use client";

import { REPLAY_SPEEDS, replayLabel } from "./replay";

/**
 * The bar fixed to the bottom of a simulation: "Replay ×4 · real time 0:48
 * / 1:14", Play or Pause, the speeds and Restart.
 */
export default function ReplayBar({
  speed,
  elapsed,
  total,
  playing,
  speeds = REPLAY_SPEEDS,
  onToggle,
  onSpeed,
  onRestart,
}: {
  speed: number;
  /** Virtual seconds into the recording. */
  elapsed: number;
  /** Seconds the recording runs. */
  total: number;
  playing: boolean;
  speeds?: readonly number[];
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onRestart: () => void;
}) {
  return (
    <div className="replay-bar" role="region" aria-label="Replay controls">
      <div className="replay-bar-inner">
        <p className="replay-bar-label">{replayLabel(speed, elapsed, total)}</p>
        <button type="button" className="btn" onClick={onToggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <span className="replay-speeds" role="group" aria-label="Replay speed">
          {speeds.map((s) => (
            <button
              key={s}
              type="button"
              className={s === speed ? "btn btn-primary" : "btn"}
              aria-pressed={s === speed}
              onClick={() => onSpeed(s)}
            >
              ×{s}
            </button>
          ))}
        </span>
        <button type="button" className="btn" onClick={onRestart}>
          Restart
        </button>
      </div>
    </div>
  );
}
