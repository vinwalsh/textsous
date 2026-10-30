import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  MAX_PHOTO_BYTES,
  PhotoError,
  detectImageType,
  photoDataUrl,
  photoToCanonical,
  readJpegOrientation,
  validatePhoto,
} from "../src/lib/intake/photo";
import type { ChatTextMessage, StructuredChatClient } from "../src/lib/model/structured";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";
import { POST } from "../src/app/api/photo/route";

/** Minimal valid PNG builder: no binary fixtures are committed. */
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = buildCrcTable();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  const check = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  out.writeUInt32BE(crc32(check), 8 + data.length);
  return out;
}

function makePng(width: number, height: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((1 + width * 3) * height);
  const idat = deflateSync(raw);
  return Buffer.concat([
    header,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Minimal JPEG with an optional EXIF orientation flag. */
function makeJpeg(orientation?: number, littleEndian = true): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    const tiff = Buffer.alloc(26);
    tiff.write(littleEndian ? "II" : "MM", 0, "latin1");
    if (littleEndian) {
      tiff.writeUInt16LE(42, 2);
      tiff.writeUInt32LE(8, 4);
      tiff.writeUInt16LE(1, 8);
      tiff.writeUInt16LE(0x0112, 10);
      tiff.writeUInt16LE(3, 12);
      tiff.writeUInt32LE(1, 14);
      tiff.writeUInt16LE(orientation, 18);
      tiff.writeUInt32LE(0, 22);
    } else {
      tiff.writeUInt16BE(42, 2);
      tiff.writeUInt32BE(8, 4);
      tiff.writeUInt16BE(1, 8);
      tiff.writeUInt16BE(0x0112, 10);
      tiff.writeUInt16BE(3, 12);
      tiff.writeUInt32BE(1, 14);
      tiff.writeUInt16BE(orientation, 18);
      tiff.writeUInt32BE(0, 22);
    }
    const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const app1 = Buffer.alloc(2 + exif.length);
    app1.writeUInt16BE(exif.length + 2, 0);
    exif.copy(app1, 2);
    parts.push(Buffer.from([0xff, 0xe1]), app1);
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function makeWebP(): Buffer {
  const out = Buffer.alloc(12);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(4, 4);
  out.write("WEBP", 8, "latin1");
  return out;
}

describe("detectImageType", () => {
  it("accepts PNG, JPEG and WebP by magic bytes", () => {
    expect(detectImageType(makePng(2, 2))).toBe("png");
    expect(detectImageType(makeJpeg())).toBe("jpeg");
    expect(detectImageType(makeWebP())).toBe("webp");
  });

  it("rejects anything else", () => {
    expect(detectImageType(Buffer.from("GIF89a", "latin1"))).toBeNull();
    expect(detectImageType(Buffer.from("not an image"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(makePng(2, 2).subarray(0, 4))).toBeNull();
  });
});

describe("validatePhoto", () => {
  it("accepts each supported type", () => {
    expect(validatePhoto(makePng(2, 2)).type).toBe("png");
    expect(validatePhoto(makeJpeg()).type).toBe("jpeg");
    expect(validatePhoto(makeWebP()).type).toBe("webp");
  });

  it("rejects files over 5 MB", () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    makePng(2, 2).copy(big, 0, 0, 8);
    try {
      validatePhoto(big);
      expect.unreachable("expected a too-large PhotoError");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoError);
      expect((error as PhotoError).code).toBe("too-large");
    }
  });

  it("rejects unsupported types", () => {
    try {
      validatePhoto(Buffer.from("GIF89a....", "latin1"));
      expect.unreachable("expected an unsupported-type PhotoError");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoError);
      expect((error as PhotoError).code).toBe("unsupported-type");
    }
  });
});

describe("readJpegOrientation", () => {
  it("defaults to 1 without EXIF", () => {
    expect(readJpegOrientation(makeJpeg())).toBe(1);
  });

  it("reads little-endian EXIF", () => {
    expect(readJpegOrientation(makeJpeg(6))).toBe(6);
  });

  it("reads big-endian EXIF", () => {
    expect(readJpegOrientation(makeJpeg(3, false))).toBe(3);
  });

  it("fails open to 1 on malformed metadata", () => {
    const bad = makeJpeg(6);
    bad.writeUInt16BE(0xffff, 4);
    expect(readJpegOrientation(bad)).toBe(1);
    expect(readJpegOrientation(makeJpeg(6).subarray(0, 10))).toBe(1);
  });

  it("returns 1 for non-JPEG bytes", () => {
    expect(readJpegOrientation(makePng(2, 2))).toBe(1);
  });
});

describe("photoDataUrl", () => {
  it("round-trips the bytes as a data URL", () => {
    const png = makePng(2, 2);
    const url = photoDataUrl(validatePhoto(png));
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(Buffer.from(url.split(",", 2)[1], "base64").equals(png)).toBe(true);
  });
});

const TRANSCRIPTION = {
  text: "Test Porridge\n\n2 cups rolled oats\n1 cup whole milk\n\n1. Simmer everything for 10 minutes.",
  book: "The Test Cookbook",
  author: "A U Thor",
  page: 7,
};

function makeRecipeResponse(): CanonicalRecipe {
  return {
    version: 1,
    id: "rcp-model",
    title: "Test Porridge",
    source: {
      kind: "text",
      url: null,
      site: null,
      author: null,
      book: null,
      page: null,
      license: null,
    },
    cuisine: null,
    nativeServings: 2,
    servingsLarge: null,
    scalingNotes: null,
    ingredients: [
      {
        id: "ing-9",
        name: "rolled oats",
        quantity: "2",
        unit: "cups",
        quantity4: null,
        scaleRule: null,
        allergens: ["gluten"],
        allergenTraces: [],
        note: null,
      },
      {
        id: "ing-10",
        name: "whole milk",
        quantity: "1",
        unit: "cup",
        quantity4: null,
        scaleRule: null,
        allergens: ["milk"],
        allergenTraces: [],
        note: null,
      },
    ],
    steps: [{ id: "step-9", kind: "active", text: "Simmer everything for 10 minutes." }],
    equipment: [],
    sourceFingerprint: "sha256:model",
  };
}

function queueClient(payloads: unknown[]): {
  client: StructuredChatClient;
  seen: ChatTextMessage[][];
} {
  const seen: ChatTextMessage[][] = [];
  let n = 0;
  const client: StructuredChatClient = {
    chat: {
      completions: {
        create: async (params) => {
          seen.push(params.messages);
          const body = payloads[Math.min(n, payloads.length - 1)];
          n += 1;
          return {
            choices: [{ message: { content: JSON.stringify(body) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  };
  return { client, seen };
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

describe("photoToCanonical", () => {
  it("transcribes then canonicalizes with a photo source and needs_review status", async () => {
    const { client, seen } = queueClient([TRANSCRIPTION, makeRecipeResponse()]);
    const result = await photoToCanonical(makePng(4, 4), { client });
    expect(result.status).toBe("needs_review");
    expect(result.transcription).toEqual(TRANSCRIPTION);
    expect(result.recipe.title).toBe("Test Porridge");
    expect(result.recipe.source).toEqual({
      kind: "photo",
      url: null,
      site: null,
      author: "A U Thor",
      book: "The Test Cookbook",
      page: 7,
      license: null,
    });
    expect(result.usage.transcribe.totalTokens).toBe(15);
    expect(result.usage.canonicalize.totalTokens).toBe(15);
    expect(result.canonicalizeResult.checks.length).toBeGreaterThan(0);

    expect(seen).toHaveLength(2);
    const photoMessage = seen[0][1];
    expect(Array.isArray(photoMessage.content)).toBe(true);
    const parts = photoMessage.content as Array<{ type: string; image_url?: { url: string } }>;
    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart?.image_url?.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(seen[1][1].content as string).toContain("2 cups rolled oats");
  });

  it("normalizes blank credit to null", async () => {
    const { client } = queueClient([
      { ...TRANSCRIPTION, book: "", author: "  ", page: null },
      makeRecipeResponse(),
    ]);
    const result = await photoToCanonical(makePng(4, 4), { client });
    expect(result.recipe.source.book).toBeNull();
    expect(result.recipe.source.author).toBeNull();
    expect(result.recipe.source.page).toBeNull();
  });

  it("tells the model about non-upright EXIF orientation", async () => {
    const { client, seen } = queueClient([TRANSCRIPTION, makeRecipeResponse()]);
    await photoToCanonical(makeJpeg(6), { client });
    expect(seen[0][0].content as string).toContain("orientation flag is 6");
  });
});

function snapshotDir(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir));
  } catch {
    return new Set();
  }
}

/** New files since the snapshot whose content includes the marker bytes. */
function newFilesWithMarker(dir: string, before: Set<string>, marker: Buffer): string[] {
  const hits: string[] = [];
  let after: string[];
  try {
    after = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of after) {
    if (before.has(name)) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (!st.isFile() || st.size > 16 * 1024 * 1024) continue;
      if (readFileSync(full).includes(marker)) hits.push(full);
    } catch {
      // Ignore races with other processes.
    }
  }
  return hits;
}

/** Copy bytes into a fresh ArrayBuffer (the DOM File typing rejects Buffers). */
function filePart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function photoRequest(file: File | null): Request {
  const form = new FormData();
  if (file) form.set("photo", file);
  return new Request("http://localhost/api/photo", { method: "POST", body: form });
}

describe("POST /api/photo", () => {
  it("rejects a missing photo field with 400", async () => {
    const res = await POST(photoRequest(null));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/multipart field "photo"/);
  });

  it("rejects unsupported image types with 400", async () => {
    const gif = new File([filePart(Buffer.from("GIF89a....", "latin1"))], "photo.gif", {
      type: "image/gif",
    });
    const res = await POST(photoRequest(gif));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/PNG, JPEG or WebP/);
  });

  it("rejects oversize photos with 413", async () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    makePng(2, 2).copy(big, 0, 0, 8);
    const file = new File([filePart(big)], "big.png", { type: "image/png" });
    const res = await POST(photoRequest(file));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/5 MB/);
  });

  it("never stores the image bytes on disk or in logs", async () => {
    delete process.env.MODEL_API_KEY;
    const png = makePng(8, 8);
    const marker = photoDataUrl(validatePhoto(png)).slice(0, 64);
    const beforeTmp = snapshotDir(tmpdir());
    const beforeCwd = snapshotDir(process.cwd());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const file = new File([filePart(png)], "photo.png", { type: "image/png" });
      const res = await POST(photoRequest(file));
      expect(res.status).toBe(500);
      expect(newFilesWithMarker(tmpdir(), beforeTmp, png)).toEqual([]);
      expect(newFilesWithMarker(process.cwd(), beforeCwd, png)).toEqual([]);
      for (const call of logSpy.mock.calls) {
        for (const arg of call) {
          if (typeof arg === "string") expect(arg).not.toContain(marker);
        }
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});
