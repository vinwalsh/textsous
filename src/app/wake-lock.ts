/**
 * Keep the screen on while a long request runs. A conversion takes 3 to 4
 * minutes, and a phone that locks (or a tab in the background) suspends the
 * page and drops the pending request. Does nothing where the Screen Wake
 * Lock API is missing or refuses (desktop browsers without it, low battery).
 */

interface WakeLockLike {
  request(type: "screen"): Promise<{ release(): Promise<void> }>;
}

function currentWakeLock(): WakeLockLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

/** Ask for the screen to stay on; returns a release function (safe to call twice). */
export async function keepScreenOn(wakeLock: WakeLockLike | undefined = currentWakeLock()): Promise<() => void> {
  try {
    const sentinel = await wakeLock?.request("screen");
    if (!sentinel) return () => {};
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sentinel.release().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** Run `work` with the screen kept on, releasing it however `work` ends. */
export async function withScreenOn<T>(work: () => Promise<T>, wakeLock?: WakeLockLike): Promise<T> {
  // Asked for in parallel, so the request never waits on the wake lock.
  const lock = keepScreenOn(wakeLock ?? currentWakeLock());
  try {
    return await work();
  } finally {
    (await lock)();
  }
}
