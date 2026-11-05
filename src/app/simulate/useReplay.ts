"use client";

import { useCallback, useEffect, useState } from "react";
import { ReplayPlayer } from "./replay";

export interface Replay {
  player: ReplayPlayer;
  /** Virtual seconds into the recording, refreshed a few times a second. */
  elapsed: number;
  playing: boolean;
  speed: number;
  toggle: () => void;
  setSpeed: (speed: number) => void;
  /** Back to 0:00, playing. */
  restart: () => void;
}

/**
 * One replay clock as React state. The player lives for the page; the
 * numbers shown come from state the effects update, so the server and the
 * first client render agree (0:00).
 */
export function useReplay(initialSpeed: number): Replay {
  // Built once for the page; never replaced.
  const [player] = useState(() => new ReplayPlayer(initialSpeed));
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeedState] = useState(initialSpeed);

  useEffect(() => {
    const read = (): void => {
      setElapsed(player.elapsed());
      setPlaying(player.playing);
      setSpeedState(player.speed);
    };
    const unsubscribe = player.subscribe(read);
    const id = setInterval(read, 250);
    read();
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [player]);

  const toggle = useCallback(() => player.toggle(), [player]);
  const setSpeed = useCallback((next: number) => player.setSpeed(next), [player]);
  const restart = useCallback(() => player.restart(), [player]);

  return { player, elapsed, playing, speed, toggle, setSpeed, restart };
}
