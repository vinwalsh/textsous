import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorBox from "../src/app/ErrorBox";
import { assistantsHref, friendlyError } from "../src/app/request";

const RECIPE = "https://example.com/recipes/toast?x=1&y=2";

describe("daily cap call to action (C2)", () => {
  it("sends a daily_cap 429 to /assistants with the recipe url", () => {
    const err = friendlyError(429, "Today's free conversions are used up.", {
      reason: "daily_cap",
      recipeUrl: RECIPE,
    });
    expect(err.title).toBe("Today's free conversions are used up");
    expect(err.action).toBe("assistants");
    expect(err.href).toBe(`/assistants?url=${encodeURIComponent(RECIPE)}`);
  });

  it("treats a 429 without reason that mentions Daily as the daily cap", () => {
    const err = friendlyError(429, "Daily conversion cap reached.", { recipeUrl: RECIPE });
    expect(err.action).toBe("assistants");
    expect(err.href).toContain("/assistants?url=");
  });

  it("links to /assistants without a url for text and photo", () => {
    expect(friendlyError(429, "", { reason: "daily_cap" }).href).toBe("/assistants");
    expect(assistantsHref("")).toBe("/assistants");
    expect(assistantsHref("javascript:alert(1)")).toBe("/assistants");
  });

  it("keeps the rate-limit copy for rate_limited, even if the text says daily", () => {
    for (const message of ["Rate limit exceeded. Try again later.", "Daily-ish wording"]) {
      const err = friendlyError(429, message, { reason: "rate_limited", recipeUrl: RECIPE });
      expect(err.title).toBe("Slow down a little");
      expect(err.action).toBeUndefined();
    }
    expect(friendlyError(429, "Rate limit exceeded. Try again later.").title).toBe("Slow down a little");
  });

  it("renders the assistants button in the error box", () => {
    const err = friendlyError(429, "", { reason: "daily_cap", recipeUrl: RECIPE });
    const html = renderToStaticMarkup(createElement(ErrorBox, { error: err }));
    expect(html).toContain("Today&#x27;s free conversions are used up");
    expect(html).toContain(`href="/assistants?url=${encodeURIComponent(RECIPE).replace(/&/g, "&amp;")}"`);
    expect(html).toContain("Continue in your AI assistant");
  });
});
