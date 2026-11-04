/** Browser-only capability, isolated from guide/timer clocks. The controller is
 * environment-injected so request/release races can be checked without a DOM. */
export type ScreenWakeLockStatus = "idle" | "requesting" | "active" | "unsupported" | "unavailable";
export interface ScreenWakeLockHandle {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}
export interface ScreenWakeLockEnvironment {
  request?: () => Promise<ScreenWakeLockHandle>;
  visible: boolean;
  onStatus: (status: ScreenWakeLockStatus) => void;
}

export function createScreenWakeLockController(environment: ScreenWakeLockEnvironment) {
  let active = false;
  let visible = environment.visible;
  let disposed = false;
  let generation = 0;
  let pending = false;
  let status: ScreenWakeLockStatus = "idle";
  let held: { handle: ScreenWakeLockHandle; onRelease: () => void } | null = null;
  const report = (next: ScreenWakeLockStatus) => {
    if (next === status) return;
    status = next;
    if (!disposed) environment.onStatus(next);
  };
  const releaseQuietly = async (handle: ScreenWakeLockHandle) => {
    // Browser/OS failure must never reject an event handler or change cooking.
    try { if (!handle.released) await handle.release(); } catch { /* Optional capability. */ }
  };
  const stop = () => {
    generation++;
    pending = false;
    if (held) {
      const { handle, onRelease } = held;
      held = null;
      handle.removeEventListener("release", onRelease);
      void releaseQuietly(handle);
    }
    report("idle");
  };
  const request = async () => {
    if (disposed || !active || !visible || held || pending) return;
    if (!environment.request) { report("unsupported"); return; }
    const token = ++generation;
    pending = true;
    report("requesting");
    try {
      const handle = await environment.request();
      if (disposed || token !== generation || !active || !visible) {
        await releaseQuietly(handle);
        return;
      }
      pending = false;
      if (handle.released) { report("unavailable"); return; }
      const onRelease = () => {
        if (held?.handle !== handle) return;
        held = null;
        handle.removeEventListener("release", onRelease);
        // Do not repeatedly challenge a low-battery/user/browser release.
        // A later visible transition, new cook or explicit retry can retry.
        report(active && visible ? "unavailable" : "idle");
      };
      held = { handle, onRelease };
      handle.addEventListener("release", onRelease);
      if (handle.released) onRelease();
      else report("active");
    } catch {
      if (disposed || token !== generation) return;
      pending = false;
      report(active && visible ? "unavailable" : "idle");
    }
  };
  return {
    getStatus: () => status,
    setActive(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      if (!active) stop();
      else void request();
    },
    setVisible(next: boolean) {
      if (disposed || next === visible) return;
      visible = next;
      if (!visible) stop();
      else void request();
    },
    retry() { void request(); },
    dispose() {
      if (disposed) return;
      // No status callback after unmount. Late requests still release themselves.
      disposed = true;
      active = false;
      stop();
    },
  };
}
