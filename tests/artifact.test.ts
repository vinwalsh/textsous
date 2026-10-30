import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CookAlongArtifact } from "../src/lib/schema/artifact";
import {
  ARTIFACT_TTL_SECONDS,
  isArtifactId,
  loadArtifact,
  saveArtifact,
  signArtifactId,
  verifyArtifactSignature,
} from "../src/lib/artifact-store";
import { buildImportUrl, buildSignedArtifactUrl } from "../src/lib/handoff";
import { POST } from "../src/app/api/artifact/route";
import { GET } from "../src/app/api/artifact/[id]/route";

const SECRET = "test-secret-123";

function makeArtifact(): CookAlongArtifact {
  return {
    formatVersion: 1,
    id: "art-probe",
    recipe: {
      title: "Probe Soup",
      servings: 2,
      ingredients: [
        {
          id: "ing-1",
          name: "stock",
          quantity: "2",
          unit: "cups",
          quantity4: null,
          scaleRule: null,
          cookQuantity: null,
          buyQuantity: null,
          allergens: [],
          allergenTraces: [],
          note: null,
        },
      ],
      equipment: [],
      steps: [{ id: "step-1", kind: "active", text: "Simmer." }],
      allergens: [],
      originalMethod: "",
      methodLabel: "",
      methodNotice: "",
      credit: {
        kind: "text",
        site: null,
        author: null,
        url: null,
        book: null,
        page: null,
        license: null,
      },
    },
    timelineDefinition: {
      lanes: [{ id: "lane-1", label: "Pot", color: "#000000", kind: "component" }],
      tasks: [
        {
          id: "t-1",
          phase: "cook",
          label: "Simmer",
          cardTitle: { action: "Simmer", subject: "soup", context: "" },
          description: "Simmer.",
          completionCue: "Hot.",
          minutes: 10,
          range: null,
          timingBasis: "estimate",
          sourceQuote: null,
          attention: "unattended",
          timerEnabledByDefault: true,
          laneIds: ["lane-1"],
          dependencies: [],
          sourceStepIds: ["step-1"],
          checkpoints: [],
          tip: null,
          equipmentEvent: null,
          scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
        },
      ],
      resources: [],
      resourceHolds: [],
      serveTaskId: "t-1",
    },
    equipmentProfile: { burners: 4, oven: true },
    changes: [],
  };
}

let dir = "";
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ARTIFACT_SIGNING_SECRET",
    "ARTIFACT_STORE_DIR",
  ]) {
    savedEnv[key] = process.env[key];
  }
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.ARTIFACT_SIGNING_SECRET = SECRET;
  dir = mkdtempSync(join(tmpdir(), "artifacts-"));
  process.env.ARTIFACT_STORE_DIR = dir;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function postReq(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/artifact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function getCtx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("artifact signatures", () => {
  it("verifies a signature it just made", () => {
    const id = randomUUID();
    const sig = signArtifactId(id, 123, SECRET);
    expect(verifyArtifactSignature(id, 123, sig, SECRET)).toBe(true);
  });

  it("rejects tampered and malformed signatures", () => {
    const id = randomUUID();
    const sig = signArtifactId(id, 123, SECRET);
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(verifyArtifactSignature(id, 123, flipped, SECRET)).toBe(false);
    expect(verifyArtifactSignature(id, 123, sig, "wrong-secret")).toBe(false);
    expect(verifyArtifactSignature(randomUUID(), 123, sig, SECRET)).toBe(false);
    expect(verifyArtifactSignature(id, 124, sig, SECRET)).toBe(false);
    expect(verifyArtifactSignature(id, 123, "xyz", SECRET)).toBe(false);
    expect(verifyArtifactSignature(id, 123, "", SECRET)).toBe(false);
  });

  it("accepts only generated id shapes", () => {
    expect(isArtifactId(randomUUID())).toBe(true);
    expect(isArtifactId("../evil")).toBe(false);
    expect(isArtifactId("nope")).toBe(false);
    expect(isArtifactId("")).toBe(false);
  });
});

describe("artifact store", () => {
  it("round-trips an artifact for 24 hours", async () => {
    expect(ARTIFACT_TTL_SECONDS).toBe(24 * 60 * 60);
    const saved = await saveArtifact(makeArtifact());
    expect(isArtifactId(saved.id)).toBe(true);
    const now = Math.floor(Date.now() / 1000);
    expect(saved.expiresAt).toBeGreaterThan(now + ARTIFACT_TTL_SECONDS - 60);
    expect(saved.expiresAt).toBeLessThanOrEqual(now + ARTIFACT_TTL_SECONDS);
    const loaded = await loadArtifact(saved.id);
    expect(loaded?.artifact).toEqual(makeArtifact());
    expect(loaded?.expiresAt).toBe(saved.expiresAt);
  });

  it("returns null for unknown and malformed ids", async () => {
    expect(await loadArtifact(randomUUID())).toBeNull();
    expect(await loadArtifact("../evil")).toBeNull();
    expect(await loadArtifact("nope")).toBeNull();
  });

  it("expires records past their TTL and prunes the file", async () => {
    const saved = await saveArtifact(makeArtifact(), { ttlSeconds: -1 });
    expect(await loadArtifact(saved.id)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("handoff URLs", () => {
  it("builds the signed fetch URL", () => {
    expect(buildSignedArtifactUrl("https://open.textsous.com", "id-1", "sig-2")).toBe(
      "https://open.textsous.com/api/artifact/id-1?sig=sig-2",
    );
  });

  it("builds the TextSous import redirect", () => {
    expect(
      buildImportUrl("https://open.textsous.com/api/artifact/id-1?sig=sig-2"),
    ).toBe(
      "https://textsous.com/import?src=https%3A%2F%2Fopen.textsous.com%2Fapi%2Fartifact%2Fid-1%3Fsig%3Dsig-2",
    );
  });
});

describe("POST /api/artifact", () => {
  it("stores a valid artifact and serves it back more than once", async () => {
    const stored = await POST(postReq({ artifact: makeArtifact() }, "10.9.9.1"));
    expect(stored.status).toBe(200);
    const body = (await stored.json()) as { url: string; expiresAt: number };
    expect(body.url).toMatch(/\/api\/artifact\/[0-9a-f-]{36}\?sig=[0-9a-f]{64}/);
    expect(typeof body.expiresAt).toBe("number");
    const id = body.url.split("/api/artifact/")[1].split("?")[0];

    const first = await GET(new Request(body.url), getCtx(id));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(makeArtifact());
    const second = await GET(new Request(body.url), getCtx(id));
    expect(second.status).toBe(200);
  });

  it("rejects an invalid artifact with 400", async () => {
    const res = await POST(postReq({ artifact: { id: "nope" } }, "10.9.9.2"));
    expect(res.status).toBe(400);
  });

  it("fails closed without a signing secret", async () => {
    delete process.env.ARTIFACT_SIGNING_SECRET;
    const res = await POST(postReq({ artifact: makeArtifact() }, "10.9.9.3"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/artifact/[id]", () => {
  it("rejects a tampered signature with 403", async () => {
    const stored = await POST(postReq({ artifact: makeArtifact() }, "10.9.9.4"));
    const body = (await stored.json()) as { url: string };
    const tampered = body.url.slice(0, -1) + (body.url.endsWith("0") ? "1" : "0");
    const id = body.url.split("/api/artifact/")[1].split("?")[0];
    const res = await GET(new Request(tampered), getCtx(id));
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown, malformed and expired ids", async () => {
    const unknown = randomUUID();
    const missing = await GET(
      new Request(`http://localhost/api/artifact/${unknown}?sig=x`),
      getCtx(unknown),
    );
    expect(missing.status).toBe(404);

    const malformed = await GET(
      new Request("http://localhost/api/artifact/nope?sig=x"),
      getCtx("nope"),
    );
    expect(malformed.status).toBe(404);

    const saved = await saveArtifact(makeArtifact(), { ttlSeconds: -1 });
    const sig = signArtifactId(saved.id, saved.expiresAt, SECRET);
    const expired = await GET(
      new Request(buildSignedArtifactUrl("http://localhost", saved.id, sig)),
      getCtx(saved.id),
    );
    expect(expired.status).toBe(404);
  });

  it("fails closed without a signing secret", async () => {
    const saved = await saveArtifact(makeArtifact());
    const sig = signArtifactId(saved.id, saved.expiresAt, SECRET);
    delete process.env.ARTIFACT_SIGNING_SECRET;
    const res = await GET(
      new Request(buildSignedArtifactUrl("http://localhost", saved.id, sig)),
      getCtx(saved.id),
    );
    expect(res.status).toBe(500);
  });
});
