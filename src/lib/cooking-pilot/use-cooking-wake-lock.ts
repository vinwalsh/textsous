"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createScreenWakeLockController, type ScreenWakeLockStatus } from "./screen-wake-lock";

const serverStatus = (): ScreenWakeLockStatus => "idle";
function createStatusStore() {
  let status: ScreenWakeLockStatus = "idle";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(next: ScreenWakeLockStatus) {
      if (next === status) return;
      status = next;
      listeners.forEach(listener => listener());
    },
  };
}

/** Pass true after Cook is pressed while its usable Cook Along view is open.
 * Pausing the guide keeps the screen awake; navigation/reset/hiding releases it
 * and returning reacquires only while that cook is still active. This never pauses or advances cooking clocks.
 * https://developer.chrome.com/docs/capabilities/web-apis/wake-lock/ */
export function useCookingWakeLock(active: boolean) {
  const [store] = useState(createStatusStore);
  const status = useSyncExternalStore(store.subscribe, store.getSnapshot, serverStatus);
  const controller = useRef<ReturnType<typeof createScreenWakeLockController> | null>(null);
  useEffect(() => {
    store.publish("idle");
    const wakeLock = globalThis.isSecureContext && "wakeLock" in navigator ? navigator.wakeLock : undefined;
    const current = createScreenWakeLockController({
      request: wakeLock && typeof wakeLock.request === "function" ? () => wakeLock.request("screen") : undefined,
      visible: document.visibilityState === "visible", onStatus: store.publish,
    });
    controller.current = current;
    const onVisibility = () => current.setVisible(document.visibilityState === "visible");
    const onPageHide = () => current.setVisible(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisibility);
    current.setActive(active);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibility);
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [active, store]);
  const retry = useCallback(() => controller.current?.retry(), []);
  return { status: active ? status : "idle" as ScreenWakeLockStatus, retry };
}
