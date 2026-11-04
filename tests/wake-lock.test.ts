import { describe, expect, it, vi } from "vitest";
import { keepScreenOn, withScreenOn } from "../src/app/wake-lock";

// readiness-3: a phone that locks during a 3-4 minute conversion drops the
// request. The screen stays on while a request runs, where the API exists.

function fakeWakeLock() {
  const release = vi.fn(async () => {});
  const request = vi.fn(async (type: "screen") => {
    expect(type).toBe("screen");
    return { release };
  });
  return { wakeLock: { request }, request, release };
}

describe("keeping the screen on", () => {
  it("holds the screen during the request and lets go after, once", async () => {
    const fake = fakeWakeLock();
    const result = await withScreenOn(async () => {
      await Promise.resolve();
      expect(fake.request).toHaveBeenCalledTimes(1);
      return "done";
    }, fake.wakeLock);
    expect(result).toBe("done");
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("lets go when the request fails too", async () => {
    const fake = fakeWakeLock();
    await expect(
      withScreenOn(async () => {
        throw new Error("dropped");
      }, fake.wakeLock),
    ).rejects.toThrow("dropped");
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the API is missing or refuses", async () => {
    const release = await keepScreenOn(undefined);
    expect(() => release()).not.toThrow();
    const refused = { request: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))) };
    const releaseRefused = await keepScreenOn(refused);
    expect(() => releaseRefused()).not.toThrow();
    await expect(withScreenOn(async () => 7, refused)).resolves.toBe(7);
  });
});
