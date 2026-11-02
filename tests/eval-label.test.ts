import { describe, expect, it } from "vitest";
import { classifyError } from "../src/lib/eval-label";

describe("classifyError", () => {
  const cases: Array<[string, string]> = [
    ["Fetch timed out after 10000ms.", "fetch-error"],
    ["Fetch failed with status 403.", "fetch-error"],
    ["Refusing page with 2 recipes; single-recipe pages only.", "review-blocked"],
    ["Model output failed validation after 3 attempt(s): x", "model-error"],
    ["Model did not return valid JSON after retries.", "model-error"],
    ["Model returned empty content.", "model-error"],
    ["Missing model API key: set MODEL_API_KEY in the environment.", "config-error"],
    ["Connection error.", "model-error"],
    ["401 Incorrect API key provided.", "model-error"],
    ["429 Rate limit reached.", "model-error"],
    ["Something completely different.", "unknown-error"],
  ];
  for (const [message, expected] of cases) {
    it(`"${message}" → ${expected}`, () => {
      expect(classifyError(message)).toBe(expected);
    });
  }
});
