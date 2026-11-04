import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as request from "../src/app/request";
import { EmbedStatus, convertErrorOptions, convertFailure } from "../src/app/embed/EmbedApp";
import type { FriendlyError } from "../src/app/request";

vi.mock("../src/app/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app/request")>();
  return { ...actual, friendlyError: vi.fn(actual.friendlyError) };
});

const recipe = "https://blog.example.com/soup";
const dailyCap = {
  status: 429,
  timeout: false,
  data: { error: "Daily conversion limit reached. Try again tomorrow.", reason: "daily_cap" },
};

describe("/embed daily cap (C2/C7)", () => {
  it("passes the 429 reason and the recipe URL to friendlyError", () => {
    const spy = vi.mocked(request.friendlyError);
    spy.mockClear();
    convertFailure(dailyCap, recipe);
    expect(spy).toHaveBeenCalledWith(429, dailyCap.data.error, {
      timeout: false,
      reason: "daily_cap",
      recipeUrl: recipe,
      mayFinish: true,
    });
  });

  it("passes rate_limited through so a message that mentions 'daily' isn't read as the cap", () => {
    expect(
      convertErrorOptions({ timeout: false, data: { error: "daily-ish", reason: "rate_limited" } }, recipe),
    ).toEqual({ timeout: false, reason: "rate_limited", recipeUrl: recipe, mayFinish: true });
  });

  it("tolerates a missing or odd reason and a non-JSON body", () => {
    expect(convertErrorOptions({ timeout: false, data: { error: "Daily limit" } }, recipe)).toEqual({
      timeout: false,
      recipeUrl: recipe,
      mayFinish: true,
    });
    expect(convertErrorOptions({ timeout: true, data: null }, recipe)).toEqual({
      timeout: true,
      recipeUrl: recipe,
      mayFinish: true,
    });
    expect(convertErrorOptions({ timeout: false, data: { reason: 7 } }, recipe)).toEqual({
      timeout: false,
      recipeUrl: recipe,
      mayFinish: true,
    });
  });

  it("still reads as the daily cap", () => {
    expect(convertFailure(dailyCap, recipe).title).toMatch(/conversions are used up/i);
  });

  // Runs once the skills stream's request.ts (assistantsHref, C7) is merged in.
  it.runIf("assistantsHref" in request)("links the cap to /assistants?url=<this recipe>", () => {
    const error = convertFailure(dailyCap, recipe) as FriendlyError & { href?: string };
    expect(error.action as string).toBe("assistants");
    expect(error.href).toBe(`/assistants?url=${encodeURIComponent(recipe)}`);
  });

  it("hides 'Try on TextSous Open' next to the assistants way forward (the open site is capped too)", () => {
    const capped = {
      title: "Today's free conversions are used up",
      detail: "Keep going in your own AI assistant.",
      action: "assistants",
      href: `/assistants?url=${encodeURIComponent(recipe)}`,
    } as unknown as FriendlyError;
    const html = renderToString(
      createElement(EmbedStatus, { state: { kind: "error", error: capped, url: recipe }, onClose: () => {} }),
    );
    expect(html).toContain("free conversions are used up");
    expect(html).not.toContain("Try on TextSous Open");
    expect(html).toContain(">Close</button>");
  });
});
