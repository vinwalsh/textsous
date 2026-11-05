/**
 * Replays of recorded conversions (/simulate). A recording is the NDJSON
 * events one real POST /api/convert sent, each with the second it arrived.
 * A replay feeds them to the same reducer the live page uses, through the
 * event source seam of runConversion, paced by a clock that runs at a chosen
 * speed and can pause. No model call, no /api/adjust: everything on screen
 * comes from the recording. Pure except ReplayPlayer, which owns timers.
 */
import type { ConvertEvent } from "../../lib/convert-events";
import type { ConversionEventSource } from "../conversion";

export interface RecordedEvent {
  /** Seconds after the request when the event arrived. */
  at: number;
  event: ConvertEvent;
}

export type Recording = RecordedEvent[];

const EVENT_TYPES = new Set(["facts", "overview", "recipe", "procedure", "done", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A recording from JSON: a non-empty array of {at, event}, times non-decreasing, the last event `done`. Throws. */
export function parseRecording(value: unknown): Recording {
  if (!Array.isArray(value) || value.length === 0) throw new Error("A recording is a non-empty array.");
  let last = 0;
  return value.map((item, i) => {
    if (!isRecord(item) || typeof item.at !== "number" || !Number.isFinite(item.at) || item.at < 0) {
      throw new Error(`Recorded event ${i}: "at" must be a non-negative number of seconds.`);
    }
    if (item.at < last) throw new Error(`Recorded event ${i} arrives before the one before it.`);
    last = item.at;
    const event = item.event;
    if (!isRecord(event) || typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) {
      throw new Error(`Recorded event ${i}: not a conversion event.`);
    }
    if (i === value.length - 1 && event.type !== "done") throw new Error("A recording ends with done.");
    return { at: item.at, event: event as unknown as ConvertEvent };
  });
}

/** Seconds the recorded conversion took. Pure. */
export function recordingDuration(recording: Recording): number {
  return recording.length > 0 ? recording[recording.length - 1].at : 0;
}

/** The events that had arrived `seconds` into the recording. Pure. */
export function eventsBy(recording: Recording, seconds: number): ConvertEvent[] {
  return recording.filter((item) => item.at <= seconds).map((item) => item.event);
}

/** The replay speeds a conversion replay offers. */
export const REPLAY_SPEEDS = [1, 2, 4, 8, 16] as const;

/** How much faster the glasses guide clock may run on /simulate/glasses. */
export const GLASSES_SPEEDS = [1, 5, 10, 20, 60] as const;

/** `?speed=` as a number from `allowed`, else `fallback`. Pure. */
export function parseSpeed(raw: string | string[] | undefined, allowed: readonly number[], fallback: number): number {
  const text = Array.isArray(raw) ? raw[0] : raw;
  const value = Number(text);
  return allowed.includes(value) ? value : fallback;
}

/** The replay clock: virtual seconds elapsed, running at `speed` since `startedAt` (real ms) or paused. */
export interface ReplayClock {
  speed: number;
  /** Virtual seconds banked while paused or before the last speed change. */
  elapsed: number;
  startedAt: number | null;
}

export function idleClock(speed: number): ReplayClock {
  return { speed, elapsed: 0, startedAt: null };
}

/** Virtual seconds into the recording at real time `now` (ms). Pure. */
export function clockElapsed(clock: ReplayClock, now: number): number {
  const running = clock.startedAt === null ? 0 : (Math.max(0, now - clock.startedAt) / 1000) * clock.speed;
  return clock.elapsed + running;
}

export function playClock(clock: ReplayClock, now: number): ReplayClock {
  return clock.startedAt === null ? { ...clock, startedAt: now } : clock;
}

export function pauseClock(clock: ReplayClock, now: number): ReplayClock {
  return clock.startedAt === null ? clock : { ...clock, elapsed: clockElapsed(clock, now), startedAt: null };
}

/** Change speed without losing the elapsed time (banks it first). Pure. */
export function withSpeed(clock: ReplayClock, speed: number, now: number): ReplayClock {
  const banked = pauseClock(clock, now);
  return { speed, elapsed: banked.elapsed, startedAt: clock.startedAt === null ? null : now };
}

/** "0:48" for 48 whole seconds. Pure. */
export function formatSeconds(wholeSeconds: number): string {
  const whole = Math.max(0, Math.round(wholeSeconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * "Replay ×4 · real time 0:48 / 1:14": the elapsed second so far (rounded
 * down) over the recording's length (rounded up, so 73.8 s reads 1:14), and
 * the full length once the replay is over. Pure.
 */
export function replayLabel(speed: number, elapsedSeconds: number, totalSeconds: number): string {
  const end = Math.ceil(totalSeconds);
  const shown = elapsedSeconds >= totalSeconds ? end : Math.floor(elapsedSeconds);
  return `Replay ×${speed} · real time ${formatSeconds(shown)} / ${formatSeconds(end)}`;
}

/** Real ms until virtual second `at` comes, on a running clock; null while paused or once it has. Pure. */
export function msUntil(clock: ReplayClock, at: number, now: number): number | null {
  const left = at - clockElapsed(clock, now);
  if (left <= 0) return 0;
  return clock.startedAt === null ? null : (left / clock.speed) * 1000;
}

/**
 * The clock with Play, Pause, speed and Restart, and a wait on a virtual
 * second for the event source. Listeners hear every change; a wait resets
 * its timer on each one, so a pause holds the next event and a speed change
 * brings it sooner or later.
 */
export class ReplayPlayer {
  private clock: ReplayClock;
  private listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(speed: number, now: () => number = Date.now) {
    this.now = now;
    this.clock = playClock(idleClock(speed), now());
  }

  get state(): ReplayClock {
    return this.clock;
  }

  get playing(): boolean {
    return this.clock.startedAt !== null;
  }

  get speed(): number {
    return this.clock.speed;
  }

  /** Virtual seconds into the recording now. */
  elapsed(): number {
    return clockElapsed(this.clock, this.now());
  }

  play(): void {
    this.set(playClock(this.clock, this.now()));
  }

  pause(): void {
    this.set(pauseClock(this.clock, this.now()));
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.set(withSpeed(this.clock, speed, this.now()));
  }

  /** Back to 0:00, playing, at the same speed. */
  restart(): void {
    this.set(playClock(idleClock(this.clock.speed), this.now()));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves once the clock reaches virtual second `at`, or at once when `signal` aborts. */
  waitUntil(at: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe = (): void => {};
      const recheck = (): void => {
        if (timer !== null) clearTimeout(timer);
        const wait = signal?.aborted ? 0 : msUntil(this.clock, at, this.now());
        if (wait === 0) {
          unsubscribe();
          signal?.removeEventListener("abort", recheck);
          resolve();
          return;
        }
        // Paused: nothing to wait for until the next change.
        timer = wait === null ? null : setTimeout(recheck, wait + 1);
      };
      unsubscribe = this.subscribe(recheck);
      signal?.addEventListener("abort", recheck);
      recheck();
    });
  }

  private set(next: ReplayClock): void {
    this.clock = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** An event source for runConversion that plays `recording` on `player`'s clock. */
export function replaySource(recording: Recording, player: ReplayPlayer): ConversionEventSource {
  return async function* events(_body, signal) {
    for (const { at, event } of recording) {
      await player.waitUntil(at, signal);
      if (signal.aborted) return;
      yield event;
    }
  };
}

/** The line every simulation page carries. */
export const SIMULATION_NOTE = "Simulation: a replay of a real conversion recorded on Nov 4, 2026";

/** Why the Apply button is off on a replay. */
export const ADJUST_NOTE = "Adjustments are live on the real page";
