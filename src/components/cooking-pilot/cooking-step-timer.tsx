"use client";

import { useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import type { LaneTimerState, readLaneTimer } from "@/lib/cooking-pilot/timeline-session";
import styles from "./cooking-step-timer.module.css";

type TimerReadout = ReturnType<typeof readLaneTimer>;
interface Props {
  id: string;
  label: string;
  timer: TimerReadout | null;
  state?: LaneTimerState;
  presetSeconds: number;
  disabled: boolean;
  onToggle: () => void;
  onReset: () => void;
  onConfigure: (mode: "countdown" | "count-up", seconds: number) => void;
  onEdit: () => void;
}
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
};

/** The card owns controls, while the parent owns the durable clock. Native
 * dialog settings stay outside the clipped timeline in the browser top layer. */
export function CookingStepTimer({ id, label, timer, state, presetSeconds, disabled, onToggle, onReset, onConfigure, onEdit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const duration = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"countdown" | "count-up">("countdown");
  const [minutes, setMinutes] = useState("5");
  const [error, setError] = useState("");
  const isCountdown = (timer?.mode ?? "countdown") === "countdown";
  const used = Boolean(timer?.isRunning || (state?.accumulatedMs ?? 0) > 0);
  const value = timer ? isCountdown ? timer.isDue ? "+" + clock(timer.overdueMs / 1000)
    : clock(timer.remainingSeconds ?? 0) : clock(timer.elapsedMs / 1000) : clock(presetSeconds);
  const caption = timer?.isDue ? "Time to check" : timer?.isRunning ? isCountdown ? "remaining" : "counting up"
    : state?.accumulatedMs ? "stopped" : isCountdown ? "countdown" : "count up";

  function openSettings() {
    onEdit();
    setMode(state?.mode ?? "countdown");
    setMinutes(String((state?.countdownSeconds ?? presetSeconds) / 60));
    setError("");
    dialog.current?.showModal();
    window.requestAnimationFrame(() => {
      if (!used) { duration.current?.focus(); duration.current?.select(); }
    });
  }

  return <div className={styles.timer} data-timer-id={id} data-due={Boolean(timer?.isDue)} role="group" aria-label={label + " timer controls"}>
    <div className={styles.controls}>
      <button type="button" className={styles.value} aria-label={"Edit " + label + " timer"} aria-haspopup="dialog"
        disabled={disabled} onClick={openSettings} style={{ fontSize: Math.min(20, 100 / value.length) }} title="Tap the time to adjust this timer">
        <span role="timer" aria-label={label + (isCountdown ? " countdown" : " elapsed time")} aria-live="off">{value}</span>
      </button>
      <button type="button" className={styles.toggle} aria-label={(timer?.isRunning ? "Stop " : "Start ") + label + " timer"}
        title={timer?.isRunning ? "Stop timer" : "Start timer"} disabled={disabled} onClick={onToggle}>
        {timer?.isRunning ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      </button>
      <span className={styles.caption}>{caption}</span>
      <button type="button" className={styles.reset} aria-label={"Reset " + label + " timer"} title="Reset timer" disabled={disabled} onClick={onReset}><RotateCcw size={15} aria-hidden="true" /></button>
    </div>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={"timer-title-" + id} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <form onSubmit={event => {
        event.preventDefault();
        const seconds = Number(minutes) * 60;
        if (mode === "countdown" && (!Number.isInteger(Number(minutes)) || seconds < 60 || seconds > 86400)) {
          setError("Choose a countdown from 1 to 1,440 whole minutes."); return;
        }
        onConfigure(mode, mode === "countdown" ? seconds : (state?.countdownSeconds ?? presetSeconds));
        dialog.current?.close();
      }}>
        <button type="button" className={styles.close} aria-label="Close timer settings" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
        <h3 id={"timer-title-" + id}>Step timer</h3><p>{label}</p>
        <label>Timer mode<select aria-label={label + " timer mode"} value={mode} disabled={disabled || used} onChange={event => setMode(event.target.value as "countdown" | "count-up")}>
          <option value="countdown">Countdown</option><option value="count-up">Count up</option>
        </select></label>
        {mode === "countdown" && <label>Minutes<input ref={duration} type="number" min={1} max={1440} step={1} value={minutes}
          aria-label={label + " countdown minutes"} disabled={disabled || used} onChange={event => setMinutes(event.target.value)} /></label>}
        {used && <p className={styles.hint}>Reset this timer to change its settings. Reset stops this timer and clears its elapsed time.</p>}
        {error && <p role="alert" className={styles.hint}>{error}</p>}
        <div className={styles.actions}>{used
          ? <button type="button" disabled={disabled} onClick={onReset}><RotateCcw size={15} aria-hidden="true" />Reset timer</button>
          : <button type="submit" disabled={disabled}>Save timer</button>}
          <button type="button" onClick={() => dialog.current?.close()}>Done</button></div>
      </form>
    </dialog>
  </div>;
}
