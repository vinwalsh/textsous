/** Shared client requests with timeouts, plus friendly error copy. */

export interface ApiResult {
  ok: boolean;
  status: number | null;
  data: unknown;
  timeout: boolean;
}

/**
 * Client wait for convert, adjust and photo: longer than the longest server
 * function limit (convert, 420 s), so the server's own friendly error
 * arrives first.
 */
export const API_TIMEOUT_MS = 430_000;

/** fetch with an abort timeout and a forgiving JSON parse. Never throws. */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS,
): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const data: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data, timeout: false };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return { ok: false, status: null, data: null, timeout };
  } finally {
    clearTimeout(timer);
  }
}

export interface FriendlyError {
  title: string;
  detail: string;
  /** Follow-up the UI can offer, if any. */
  action?: "paste-text" | "assistants";
  /** Link for the "assistants" action. */
  href?: string;
  /** Technical detail kept out of the main copy; shown behind "Details". */
  more?: string;
}

/** The convert response's warnings as display strings. Pure. */
export function convertNotices(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0);
}

/**
 * Class for a form's submit button: primary, except next to the daily-cap
 * error, whose "Continue in your AI assistant" is then the one primary button
 * (submitting again would only hit the cap again).
 */
export function submitButtonClass(error: Pick<FriendlyError, "action"> | null | undefined): string {
  return error?.action === "assistants" ? "btn" : "btn btn-primary";
}

/** Where people continue when the free daily conversions run out (C7). */
export function assistantsHref(recipeUrl?: string): string {
  const url = (recipeUrl ?? "").trim();
  return /^https?:\/\//i.test(url) ? `/assistants?url=${encodeURIComponent(url)}` : "/assistants";
}

/** Map API failures to copy a cook can act on. Pure: fully unit-tested. */
export function friendlyError(
  status: number | null,
  message: string,
  opts: {
    timeout?: boolean;
    /** The 429 `reason` from the API (C2), when present. */
    reason?: string;
    /** The recipe URL being converted, for the assistants link. */
    recipeUrl?: string;
    /**
     * The server keeps working after the browser lets go and caches the
     * result (a URL conversion), so a dropped connection may still finish.
     */
    mayFinish?: boolean;
  } = {},
): FriendlyError {
  if (opts.timeout) {
    return {
      title: "That took too long",
      detail: "The request timed out. Check your connection and try again.",
    };
  }
  if (status === 503 || status === 504) {
    // The server's own time limit (a slow model step or the function limit),
    // not the reader's connection and not the recipe site.
    return {
      title: "That took too long",
      detail:
        "This recipe took longer than one conversion is allowed. Try again in a minute, or paste just the ingredients and steps.",
    };
  }
  if (status === null) {
    // A dropped request, usually a phone that locked or a switch to another
    // app during a 3-4 minute conversion, or no network at all.
    return {
      title: "Connection lost",
      detail: opts.mayFinish
        ? "The connection dropped, which happens when a phone locks or you switch apps. The recipe may still finish converting: wait two or three minutes and convert the same link again. Finished recipes open instantly."
        : "The connection dropped, which can happen when a phone locks or you switch apps. Check your connection and try again.",
    };
  }
  if (status === 400) {
    if (/only https/i.test(message)) {
      return {
        title: "That address won't work",
        detail:
          "Recipe pages must be https addresses. Paste the full https link — or paste the recipe text instead.",
        action: "paste-text",
      };
    }
    if (/private-network|credentials|invalid url/i.test(message)) {
      return {
        title: "That address won't work",
        detail:
          "Use a public recipe page URL — private addresses and links with passwords are refused. Or paste the recipe text instead.",
        action: "paste-text",
      };
    }
    if (/exactly one of/i.test(message)) {
      return {
        title: "One thing at a time",
        detail: "Send a URL, pasted text, or a photo — not several at once.",
      };
    }
    if (/photo|png|jpeg|webp/i.test(message)) {
      return { title: "That photo won't work", detail: message };
    }
    return {
      title: "Something in that request wasn't right",
      detail: message || "Check the form and try again.",
    };
  }
  if (status === 413) {
    if (/request body is too large/i.test(message)) {
      return {
        title: "That's too much to send at once",
        detail:
          "Requests are limited to 256 KB. Paste just the one recipe, not the whole page, and try again.",
      };
    }
    if (/too large together/i.test(message)) {
      return {
        title: "Those photos are too big together",
        detail: "Try fewer or smaller photos, or a screenshot of each page.",
      };
    }
    return {
      title: "That photo is too big",
      detail: "Photos must be under 4 MB each. Try a smaller image.",
    };
  }
  if (status === 422) {
    if (/single-recipe/i.test(message)) {
      return {
        title: "One recipe at a time",
        detail:
          "That page holds several recipes. Open one recipe and convert its address instead — or paste that one recipe's text.",
        action: "paste-text",
      };
    }
    // A blocking review failure: one calm sentence, the reasons behind Details.
    const reasons = message.replace(/^compile blocked:\s*/i, "").trim();
    return {
      title: "We couldn't double-check this one",
      detail:
        "The automatic review couldn't confirm this conversion matches the original recipe, so it isn't shown. Try again, or paste the recipe text.",
      action: "paste-text",
      ...(reasons ? { more: reasons } : {}),
    };
  }
  if (status === 429) {
    const dailyCap =
      opts.reason === "daily_cap" || (opts.reason !== "rate_limited" && /daily/i.test(message));
    if (dailyCap) {
      return {
        title: "Today's free conversions are used up",
        detail:
          "Keep going in your own AI assistant (Muse, ChatGPT, Claude or Gemini) with a free TextSous account, or try again here tomorrow.",
        action: "assistants",
        href: assistantsHref(opts.recipeUrl),
      };
    }
    // The per-IP limit counts live requests over an hour, so a minute's
    // wait is not enough.
    return {
      title: "Slow down a little",
      detail:
        "This connection has reached its hourly limit. Try again within the hour — recipes that were already converted still open right away.",
    };
  }
  if (status === 500) {
    return {
      title: "Something broke on our side",
      detail: "Try again in a bit — nothing you sent was kept.",
    };
  }
  if (status === 502) {
    // Only the recipe page fetch: "Fetch timed out ...", "Fetch failed ...".
    if (/fetch timed out|fetch failed|resolve host|status \d+|redirect/i.test(message)) {
      return {
        title: "Couldn't reach that page",
        detail:
          "The recipe site didn't answer — some sites block recipe readers. Paste the recipe text instead and we'll take it from there.",
        action: "paste-text",
      };
    }
    // The page answered, but with something intake refuses every time:
    // "Page exceeds the ... byte cap.", "Unsupported content type: ...".
    if (/byte cap|content type/i.test(message)) {
      return {
        title: "We can't read that link",
        detail:
          "It isn't a recipe web page we can open (a PDF, an image or a page over 2 MB). Paste the recipe text instead.",
        action: "paste-text",
      };
    }
    return {
      title: "The recipe service stumbled",
      detail: "The conversion failed upstream. Try again in a bit.",
    };
  }
  return { title: "Something went wrong", detail: message || "Try again." };
}
