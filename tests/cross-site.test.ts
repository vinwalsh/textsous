import { beforeEach, describe, expect, it } from "vitest";
import { POST as adjustPOST } from "../src/app/api/adjust/route";
import { POST as artifactPOST } from "../src/app/api/artifact/route";
import { POST as convertPOST } from "../src/app/api/convert/route";
import { POST as photoPOST } from "../src/app/api/photo/route";
import { reserveDailyUnit, resetMemoryLimits } from "../src/lib/limits";
import { fixtureArtifact } from "./helpers/fixture-artifact";

// security-1: another site's page can POST to these routes through its
// visitors' browsers (no-cors fetch with a text/plain body, or a hidden
// multipart form) and spend the shared daily cap. Browsers mark such
// requests Sec-Fetch-Site: cross-site.

const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function from(site: string | undefined, path: string, body: BodyInit, contentType?: string): Request {
  const headers: Record<string, string> = { "x-forwarded-for": "10.60.0.1" };
  if (contentType) headers["content-type"] = contentType;
  if (site !== undefined) headers["sec-fetch-site"] = site;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body });
}

function photoForm(): FormData {
  const form = new FormData();
  form.set("photo", new File([PNG_1PX], "one.png", { type: "image/png" }));
  return form;
}

beforeEach(() => {
  resetMemoryLimits();
  delete process.env.MODEL_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.DAILY_CONVERSION_CAP = "1";
});

describe("POSTs started by another website", () => {
  it("are refused with 403 before any limit or daily unit is touched", async () => {
    const text = JSON.stringify({ text: "Probe soup. Serves 2." });
    const adjust = JSON.stringify({ artifact: fixtureArtifact(), voice: "sous" });
    const save = JSON.stringify({ artifact: fixtureArtifact() });
    const responses = [
      await convertPOST(from("cross-site", "/api/convert", text, "text/plain")),
      await adjustPOST(from("cross-site", "/api/adjust", adjust, "text/plain")),
      await photoPOST(from("cross-site", "/api/photo", photoForm())),
      await artifactPOST(from("cross-site", "/api/artifact", save, "text/plain")),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Requests from other websites are not accepted." });
    }
    // The only daily unit is still there.
    expect((await reserveDailyUnit()).allowed).toBe(true);
  });

  it("does not affect the app's own pages, the /embed iframe, or scripts", async () => {
    const text = JSON.stringify({ text: "Probe soup. Serves 2." });
    for (const site of ["same-origin", "same-site", "none", undefined]) {
      const res = await convertPOST(from(site, "/api/convert", text, "application/json"));
      // Reached live work: no key here, and the unit is given back.
      expect(res.status, String(site)).toBe(500);
    }
  });
});
