import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBox from "../src/app/ErrorBox";
import { apiFetch, friendlyError } from "../src/app/request";

describe("friendlyError", () => {
  const cases: Array<{
    name: string;
    status: number | null;
    message: string;
    timeout?: boolean;
    title: string;
    detailPart: RegExp;
    action?: "paste-text" | "assistants";
  }> = [
    {
      name: "client timeout",
      status: null,
      message: "",
      timeout: true,
      title: "That took too long",
      detailPart: /timed out/,
    },
    {
      name: "gateway timeout",
      status: 504,
      message: "",
      title: "That took too long",
      detailPart: /took longer than one conversion is allowed/,
    },
    {
      name: "server time limit",
      status: 503,
      message: "This recipe took too long to convert (a step timed out).",
      title: "That took too long",
      detailPart: /paste just the ingredients and steps/,
    },
    {
      name: "offline or dropped",
      status: null,
      message: "",
      title: "Connection lost",
      detailPart: /phone locks or you switch apps\. Check your connection/,
    },
    {
      name: "non-https URL",
      status: 400,
      message: "Only https URLs are accepted.",
      title: "That address won't work",
      detailPart: /https/,
      action: "paste-text",
    },
    {
      name: "private URL",
      status: 400,
      message: "Refused private-network URL.",
      title: "That address won't work",
      detailPart: /public recipe page/,
      action: "paste-text",
    },
    {
      name: "ambiguous body",
      status: 400,
      message: "Provide exactly one of {url}, {text} or {recipe}.",
      title: "One thing at a time",
      detailPart: /not several/,
    },
    {
      name: "bad photo",
      status: 400,
      message: "Unsupported image type: send PNG, JPEG or WebP.",
      title: "That photo won't work",
      detailPart: /PNG, JPEG or WebP/,
    },
    {
      name: "generic 400",
      status: 400,
      message: "",
      title: "Something in that request wasn't right",
      detailPart: /form/,
    },
    {
      name: "oversize photo",
      status: 413,
      message: "Photo is larger than the 4 MB limit.",
      title: "That photo is too big",
      detailPart: /under 4 MB each/,
    },
    {
      name: "photos too large together",
      status: 413,
      message: "These photos are too large together. Try fewer or smaller photos.",
      title: "Those photos are too big together",
      detailPart: /fewer or smaller photos/,
    },
    {
      name: "oversize JSON body",
      status: 413,
      message: "Request body is too large (256 KB max).",
      title: "That's too much to send at once",
      detailPart: /256 KB/,
    },
    {
      name: "roundup page",
      status: 422,
      message: "single-recipe pages only",
      title: "One recipe at a time",
      detailPart: /several recipes/,
      action: "paste-text",
    },
    {
      name: "compile blocked",
      status: 422,
      message: "compile blocked: task_schedule",
      title: "We couldn't double-check this one",
      detailPart: /couldn't confirm this conversion matches the original recipe/,
      action: "paste-text",
    },
    {
      name: "rate limit",
      status: 429,
      message: "Rate limit exceeded. Try again later.",
      title: "Slow down a little",
      // 20 live requests an hour per IP: a minute's wait is not enough.
      detailPart: /reached its hourly limit\. Try again within the hour/,
    },
    {
      name: "daily cap",
      status: 429,
      message: "Daily conversion cap reached.",
      title: "Today's free conversions are used up",
      detailPart: /your own AI assistant/,
      action: "assistants",
    },
    {
      name: "server error",
      status: 500,
      message: "Missing model API key.",
      title: "Something broke on our side",
      detailPart: /nothing you sent was kept/,
    },
    {
      name: "unreachable page",
      status: 502,
      message: "fetch failed: timed out",
      title: "Couldn't reach that page",
      detailPart: /didn't answer/,
      action: "paste-text",
    },
    {
      name: "page fetch timeout",
      status: 502,
      message: "Fetch timed out after 10000ms.",
      title: "Couldn't reach that page",
      detailPart: /didn't answer/,
      action: "paste-text",
    },
    {
      name: "a link to a PDF or an image is refused every time",
      status: 502,
      message: "Unsupported content type: application/pdf.",
      title: "We can't read that link",
      detailPart: /isn't a recipe web page.*Paste the recipe text instead/,
      action: "paste-text",
    },
    {
      name: "a page over the size cap is refused every time",
      status: 502,
      message: "Page exceeds the 2097152 byte cap.",
      title: "We can't read that link",
      detailPart: /over 2 MB/,
      action: "paste-text",
    },
    {
      name: "a model timeout is never read as the recipe site",
      status: 502,
      message: "Request timed out.",
      title: "The recipe service stumbled",
      detailPart: /upstream/,
    },
    {
      name: "upstream validation",
      status: 502,
      message: "Model output failed validation",
      title: "The recipe service stumbled",
      detailPart: /upstream/,
    },
    {
      name: "unknown status",
      status: 418,
      message: "",
      title: "Something went wrong",
      detailPart: /Try again/,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const err = friendlyError(c.status, c.message, { timeout: c.timeout });
      expect(err.title).toBe(c.title);
      expect(err.detail).toMatch(c.detailPart);
      expect(err.action).toBe(c.action ?? undefined);
    });
  }

  it("tells a cook whose URL conversion dropped that it may still finish", () => {
    const err = friendlyError(null, "", { recipeUrl: "https://example.com/r", mayFinish: true });
    expect(err.title).toBe("Connection lost");
    // The server keeps converting, and converting again too soon starts a
    // second live conversion (fix-pass review): a minute is too short.
    expect(err.detail).toMatch(/may still finish converting: wait two or three minutes and convert the same link again/);
    expect(friendlyError(null, "").detail).not.toMatch(/still finish/);
  });

  it("keeps a blocked review's check names out of the main copy, behind Details", () => {
    const err = friendlyError(
      422,
      "compile blocked: quantities: the milk amount changed; source_fidelity: a step was added",
    );
    expect(`${err.title} ${err.detail}`).not.toMatch(/compile blocked|quantities|source_fidelity/);
    expect(err.more).toBe("quantities: the milk amount changed; source_fidelity: a step was added");
    const html = renderToStaticMarkup(createElement(ErrorBox, { error: err, onAction: () => {} }));
    expect(html).toContain("<summary>Details</summary>");
    expect(html).toContain("Paste the recipe text instead");
    expect(renderToStaticMarkup(createElement(ErrorBox, { error: friendlyError(500, "") }))).not.toContain(
      "<details",
    );
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a timeout when the server never answers", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    vi.spyOn(globalThis, "fetch").mockImplementation(hanging);
    const res = await apiFetch("http://localhost/api/convert", {}, 40);
    expect(res).toEqual({ ok: false, status: null, data: null, timeout: true });
  });

  it("parses successful JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ a: 1 }), { status: 200 }),
    );
    const res = await apiFetch("http://localhost/x");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ a: 1 });
    expect(res.timeout).toBe(false);
  });

  it("keeps the status when the body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 500 }));
    const res = await apiFetch("http://localhost/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.data).toBeNull();
  });
});
