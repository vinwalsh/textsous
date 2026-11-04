import { readFileSync } from "node:fs";
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

type Sentinel = { release: () => Promise<void> };

/**
 * A page a test can hide and show. Like browsers, hiding the page drops
 * every screen lock it holds, and a hidden page is refused a new one.
 */
function fakePage() {
  const listeners = new Set<() => void>();
  const held = new Set<Sentinel>();
  const page = {
    visibilityState: "visible" as "visible" | "hidden",
    addEventListener: (_type: "visibilitychange", listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) => void listeners.delete(listener),
  };
  const request = vi.fn(async (): Promise<Sentinel> => {
    if (page.visibilityState !== "visible") throw new Error("NotAllowedError");
    const sentinel: Sentinel = {
      release: async () => {
        held.delete(sentinel);
      },
    };
    held.add(sentinel);
    return sentinel;
  });
  function show(state: "visible" | "hidden") {
    page.visibilityState = state;
    if (state === "hidden") held.clear();
    for (const listener of [...listeners]) listener();
  }
  return { page, wakeLock: { request }, request, held, listeners, show };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keeping the screen on across an app switch (fix-pass review)", () => {
  it("asks again when the page comes back, and stops asking once the request ends", async () => {
    const fake = fakePage();
    const release = await keepScreenOn(fake.wakeLock, fake.page);
    expect(fake.held.size).toBe(1);
    fake.show("hidden"); // the browser drops the lock
    expect(fake.held.size).toBe(0);
    fake.show("visible");
    await settle();
    expect(fake.request).toHaveBeenCalledTimes(2);
    expect(fake.held.size).toBe(1);
    release();
    await settle();
    expect(fake.held.size).toBe(0);
    expect(fake.listeners.size).toBe(0);
    fake.show("hidden");
    fake.show("visible");
    await settle();
    expect(fake.request).toHaveBeenCalledTimes(2);
  });

  it("lets go of a lock that arrives after the request ended", async () => {
    const fake = fakePage();
    const release = await keepScreenOn(fake.wakeLock, fake.page);
    const late = { release: vi.fn(async () => {}) };
    let answer: (sentinel: Sentinel) => void = () => {};
    fake.request.mockImplementationOnce(() => new Promise<Sentinel>((resolve) => (answer = resolve)));
    fake.show("hidden");
    fake.show("visible"); // asks again; the answer is still on its way
    release();
    answer(late);
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(fake.held.size).toBe(0);
  });

  it("holds one lock at most when the page is shown twice in a row", async () => {
    const fake = fakePage();
    const release = await keepScreenOn(fake.wakeLock, fake.page);
    fake.show("visible");
    fake.show("visible");
    await settle();
    expect(fake.held.size).toBe(1);
    release();
    await settle();
    expect(fake.held.size).toBe(0);
  });
});

describe("the embed overlay", () => {
  it("lets its iframe keep the screen on (cross-origin frames need the allow attribute)", () => {
    expect(readFileSync("public/embed.js", "utf8")).toContain('iframe.setAttribute("allow", "screen-wake-lock")');
  });
});
