import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/photo/route";
import { MAX_PHOTO_BODY_BYTES } from "../src/lib/intake/photo";
import { reserveDailyUnit, resetMemoryLimits } from "../src/lib/limits";
import type { ChatTextMessage, StructuredChatClient } from "../src/lib/model/structured";

// /api/photo takes 1 to 3 photos of one recipe as a repeated multipart field
// "photo" (page order). Every model call goes through a fake transport.

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ messages: unknown[]; reasoning_effort?: string }>,
  skipped: false,
}));

vi.mock("../src/lib/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/model")>();
  return {
    ...actual,
    callStructured: (
      schema: Parameters<typeof actual.callStructured>[0],
      messages: Parameters<typeof actual.callStructured>[1],
      opts: Parameters<typeof actual.callStructured>[2],
    ) => actual.callStructured(schema, messages, { ...opts, client: fakeClient() }),
  };
});

function fakeClient(): StructuredChatClient {
  return {
    chat: {
      completions: {
        create: async (params) => {
          fake.calls.push({ messages: params.messages, reasoning_effort: params.reasoning_effort });
          const name = params.response_format.type === "json_schema" ? params.response_format.json_schema.name : "";
          const body = name === "photo_transcription" ? transcription() : recipe();
          return {
            choices: [{ message: { content: JSON.stringify(body) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  };
}

function transcription() {
  return {
    text: "Two Page Bread\n\n500 g flour\n10 g salt\n\n1. Mix.\n2. Bake for 40 minutes.",
    book: "Our Kitchen",
    author: null,
    page: 12,
    otherRecipeSkipped: fake.skipped,
  };
}

function recipe() {
  return {
    version: 1,
    id: "rcp-model",
    title: "Two Page Bread",
    source: { kind: "text", url: null, site: null, author: null, book: null, page: null, license: null },
    cuisine: null,
    nativeServings: 8,
    servingsLarge: null,
    scalingNotes: null,
    ingredients: [
      { id: "i1", name: "flour", quantity: "500", unit: "g", quantity4: null, scaleRule: null, allergens: ["gluten"], allergenTraces: [], note: null },
      { id: "i2", name: "salt", quantity: "10", unit: "g", quantity4: null, scaleRule: null, allergens: [], allergenTraces: [], note: null },
    ],
    steps: [
      { id: "s1", kind: "active", text: "Mix." },
      { id: "s2", kind: "active", text: "Bake for 40 minutes." },
    ],
    equipment: [],
    sourceFingerprint: "sha256:model",
  };
}

const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const JPEG_TINY = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function photo(name: string, bytes: Uint8Array = PNG_1PX, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function photoRequest(files: File[], headers: Record<string, string> = {}): Request {
  const form = new FormData();
  for (const file of files) form.append("photo", file);
  return new Request("http://localhost/api/photo", {
    method: "POST",
    headers: { "x-forwarded-for": "10.70.0.1", ...headers },
    body: form,
  });
}

type PhotoBody = {
  error?: string;
  recipe?: { title: string; source: { kind: string; book: string | null; page: number | null } };
  transcription?: Record<string, unknown>;
  status?: string;
  usage?: { transcribe: { totalTokens: number }; canonicalize: { totalTokens: number } };
  warnings?: string[];
};

let logs: string[] = [];

beforeEach(() => {
  fake.calls = [];
  fake.skipped = false;
  resetMemoryLimits();
  process.env.MODEL_API_KEY = "test-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RATE_LIMIT_PER_HOUR;
  process.env.DAILY_CONVERSION_CAP = "100";
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  return () => {
    vi.restoreAllMocks();
    delete process.env.MODEL_API_KEY;
  };
});

describe("POST /api/photo with several pages", () => {
  it("accepts one photo", async () => {
    const res = await POST(photoRequest([photo("page.png")]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotoBody;
    expect(body.status).toBe("needs_review");
    expect(body.recipe?.title).toBe("Two Page Bread");
    expect(body.transcription).toEqual({
      text: transcription().text,
      book: "Our Kitchen",
      author: null,
      page: 12,
    });
    expect(body.warnings).toEqual([]);
    const user = fake.calls[0].messages[1] as ChatTextMessage;
    expect((user.content as Array<{ type: string }>).map((p) => p.type)).toEqual(["text", "image_url"]);
  });

  it("accepts 3 photos in one transcription call, in page order, at low effort", async () => {
    const files = [photo("one.png"), photo("two.jpg", JPEG_TINY, "image/jpeg"), photo("three.png")];
    const res = await POST(photoRequest(files));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotoBody;
    expect(body.recipe?.source).toMatchObject({ kind: "photo", book: "Our Kitchen", page: 12 });
    expect(body.usage?.transcribe.totalTokens).toBe(15);
    expect(body.usage?.canonicalize.totalTokens).toBe(15);
    // One vision call for all three photos, then canonicalize.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].reasoning_effort).toBe("low");
    const parts = (fake.calls[0].messages[1] as ChatTextMessage).content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url", "image_url", "image_url"]);
    expect(parts[0].text).toMatch(/^These 3 photos are consecutive pages of ONE recipe, in order/);
    const urls = parts.slice(1).map((p) => p.image_url?.url ?? "");
    expect(urls[0].startsWith("data:image/png;base64,")).toBe(true);
    expect(urls[1]).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG_TINY).toString("base64")}`);
    expect(urls[2].startsWith("data:image/png;base64,")).toBe(true);
    // The log line counts photos and never carries image bytes.
    const line = logs.find((l) => l.includes('"event":"photo"'));
    expect(line).toContain('"photos":3');
    expect(logs.join("\n")).not.toContain("base64");
  });

  it("passes the one-recipe warning on to the confirm screen", async () => {
    fake.skipped = true;
    const res = await POST(photoRequest([photo("one.png"), photo("two.png")]));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PhotoBody).warnings).toEqual([
      "The photos show more than one recipe, so only the one that starts on the first photo was read. Convert the others one at a time.",
    ]);
  });

  it("refuses no photo with 400", async () => {
    const res = await POST(photoRequest([]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as PhotoBody).error).toBe(
      'Send 1 to 3 photos of one recipe as multipart field "photo".',
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a text value in the photo field with 400", async () => {
    const form = new FormData();
    form.append("photo", photo("one.png"));
    form.append("photo", "not a file");
    const res = await POST(new Request("http://localhost/api/photo", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses 4 photos with 400 and calm copy", async () => {
    const files = [photo("1.png"), photo("2.png"), photo("3.png"), photo("4.png")];
    const res = await POST(photoRequest(files));
    expect(res.status).toBe(400);
    expect(((await res.json()) as PhotoBody).error).toBe("Send up to 3 photos of one recipe.");
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 413 from a large content-length before reading the body", async () => {
    const res = await POST(
      photoRequest([photo("one.png")], { "content-length": String(MAX_PHOTO_BODY_BYTES + 1) }),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as PhotoBody).error).toBe(
      "These photos are too large together. Try fewer or smaller photos.",
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 413 when the photos together pass the cap without a content-length", async () => {
    const half = new Uint8Array(Math.ceil(MAX_PHOTO_BODY_BYTES / 2) + 10);
    half.set(PNG_1PX.subarray(0, 8));
    const res = await POST(photoRequest([photo("a.png", half), photo("b.png", half)]));
    expect(res.status).toBe(413);
    expect(((await res.json()) as PhotoBody).error).toMatch(/too large together/);
    expect(fake.calls).toHaveLength(0);
  });

  it("checks each photo's type and names the page", async () => {
    const gif = photo("two.gif", Uint8Array.from(Buffer.from("GIF89a....", "latin1")), "image/gif");
    const res = await POST(photoRequest([photo("one.png"), gif]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as PhotoBody).error).toBe(
      "Photo 2 has an unsupported image type: send PNG, JPEG or WebP.",
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("spends one daily unit and one rate-limit hit per request, whatever the photo count", async () => {
    process.env.DAILY_CONVERSION_CAP = "1";
    process.env.RATE_LIMIT_PER_HOUR = "1";
    const files = [photo("1.png"), photo("2.png"), photo("3.png")];
    expect((await POST(photoRequest(files))).status).toBe(200);
    // The one unit is used...
    expect((await reserveDailyUnit()).allowed).toBe(false);
    // ...and the same connection has used its one request this hour.
    const again = await POST(photoRequest([photo("1.png")]));
    expect(again.status).toBe(429);
    expect(((await again.json()) as { reason?: string }).reason).toBe("rate_limited");
  });
});
