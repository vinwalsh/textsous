/**
 * Keep the screen on while a long request runs. A conversion takes 3 to 4
 * minutes, and a phone that locks (or a tab in the background) suspends the
 * page and drops the pending request. Does nothing where the Screen Wake
 * Lock API is missing or refuses (desktop browsers without it, low battery).
 *
 * Browsers let go of a screen wake lock whenever the page is hidden (a switch
 * to another app or tab), so it is asked for again each time the page comes
 * back into view, until the request ends.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** The part of `document` this needs (injectable for tests). */
export interface PageVisibilityLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

function currentWakeLock(): WakeLockLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

function currentPage(): PageVisibilityLike | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/** Let go of a lock; one the browser already dropped is fine. */
function letGo(sentinel: WakeLockSentinelLike | null): void {
  try {
    sentinel?.release().catch(() => {});
  } catch {
    // Already released.
  }
}

/** Ask for the screen to stay on; returns a release function (safe to call twice). */
export async function keepScreenOn(
  wakeLock: WakeLockLike | undefined = currentWakeLock(),
  page: PageVisibilityLike | undefined = currentPage(),
): Promise<() => void> {
  if (!wakeLock) return () => {};
  let released = false;
  let sentinel: WakeLockSentinelLike | null = null;
  const ask = async (): Promise<void> => {
    try {
      const next = await wakeLock.request("screen");
      if (released) {
        // The request ended while this answer was on its way.
        letGo(next);
        return;
      }
      letGo(sentinel);
      sentinel = next;
    } catch {
      // Refused (hidden page, low battery, no permission): carry on without it.
    }
  };
  const onVisibilityChange = (): void => {
    if (!released && page?.visibilityState === "visible") void ask();
  };
  page?.addEventListener("visibilitychange", onVisibilityChange);
  await ask();
  return () => {
    if (released) return;
    released = true;
    page?.removeEventListener("visibilitychange", onVisibilityChange);
    letGo(sentinel);
    sentinel = null;
  };
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
