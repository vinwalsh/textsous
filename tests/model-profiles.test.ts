import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASETEN_MODEL,
  META_DEFAULT_BASE_URL,
  META_DEFAULT_MODEL,
  resolveProvider,
} from "../src/lib/model/profiles";

const KEYS = [
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_ID",
  "BASETEN_BASE_URL",
  "BASETEN_API_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveProvider", () => {
  it("meta uses MODEL_* with defaults", () => {
    expect(resolveProvider("meta")).toEqual({
      provider: "meta",
      baseUrl: META_DEFAULT_BASE_URL,
      apiKey: "",
      model: META_DEFAULT_MODEL,
    });
    process.env.MODEL_BASE_URL = "https://meta.example/v1";
    process.env.MODEL_API_KEY = "mk";
    process.env.MODEL_ID = "custom-model";
    expect(resolveProvider("meta")).toEqual({
      provider: "meta",
      baseUrl: "https://meta.example/v1",
      apiKey: "mk",
      model: "custom-model",
    });
  });

  it("baseten uses BASETEN_* with MODEL_* fallback and a fixed model", () => {
    expect(resolveProvider("baseten")).toEqual({
      provider: "baseten",
      baseUrl: META_DEFAULT_BASE_URL,
      apiKey: "",
      model: BASETEN_MODEL,
    });
    process.env.MODEL_BASE_URL = "https://meta.example/v1";
    process.env.MODEL_API_KEY = "mk";
    expect(resolveProvider("baseten").baseUrl).toBe("https://meta.example/v1");
    expect(resolveProvider("baseten").apiKey).toBe("mk");
    process.env.BASETEN_BASE_URL = "https://baseten.example/v1";
    process.env.BASETEN_API_KEY = "bk";
    expect(resolveProvider("baseten")).toEqual({
      provider: "baseten",
      baseUrl: "https://baseten.example/v1",
      apiKey: "bk",
      model: BASETEN_MODEL,
    });
  });
});
