/** Shared client requests with timeouts, plus friendly error copy. */

export interface ApiResult {
  ok: boolean;
  status: number | null;
  data: unknown;
  timeout: boolean;
}

/** fetch with an abort timeout and a forgiving JSON parse. Never throws. */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = 150_000,
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
}

/** Map API failures to copy a cook can act on. Pure: fully unit-tested. */
export function friendlyError(
  status: number | null,
  message: string,
  opts: { timeout?: boolean } = {},
): FriendlyError {
  if (opts.timeout || status === 504) {
    return {
      title: "That took too long",
      detail: "The request timed out. Check your connection and try again.",
    };
  }
  if (status === null) {
    return { title: "No connection", detail: "Check your connection and try again." };
  }
  if (status === 400) {
    if (/only https/i.test(message)) {
      return {
        title: "That address won't work",
        detail: "Recipe pages must be https addresses. Paste the full https link.",
      };
    }
    if (/private-network|credentials|invalid url/i.test(message)) {
      return {
        title: "That address won't work",
        detail:
          "Use a public recipe page URL — private addresses and links with passwords are refused.",
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
    return {
      title: "That photo is too big",
      detail: "Photos must be under 5 MB. Try a smaller image.",
    };
  }
  if (status === 422) {
    if (/single-recipe/i.test(message)) {
      return {
        title: "One recipe at a time",
        detail:
          "That page holds several recipes. Open one recipe and convert its address instead.",
      };
    }
    return {
      title: "This recipe needs a human touch",
      detail: message || "It didn't pass the automatic checks.",
    };
  }
  if (status === 429) {
    if (/daily/i.test(message)) {
      return {
        title: "Today's conversions are used up",
        detail: "The daily limit is reached. Try again tomorrow.",
      };
    }
    return {
      title: "Slow down a little",
      detail: "Too many requests in a short time. Wait a minute and try again.",
    };
  }
  if (status === 500) {
    return {
      title: "Something broke on our side",
      detail: "Try again in a bit — nothing you sent was kept.",
    };
  }
  if (status === 502) {
    if (/timed out|fetch failed|resolve host|status \d+|redirect/i.test(message)) {
      return {
        title: "Couldn't reach that page",
        detail: "The recipe site didn't answer. Check the address and try again.",
      };
    }
    return {
      title: "The recipe service stumbled",
      detail: "The conversion failed upstream. Try again in a bit.",
    };
  }
  return { title: "Something went wrong", detail: message || "Try again." };
}
