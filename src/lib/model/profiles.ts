export type ProviderName = "meta" | "baseten";

export interface ProviderConfig {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const META_DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const META_DEFAULT_MODEL = "muse-spark-1.3";
// Baseten profile always uses this model id. Endpoint and key come from
// BASETEN_BASE_URL / BASETEN_API_KEY, falling back to MODEL_BASE_URL /
// MODEL_API_KEY when unset.
export const BASETEN_MODEL = "meta-models/muse-spark-open-1026";

export function isContributorModel(modelId: string): boolean {
  return modelId.trim().endsWith("-contributor");
}

export function resolveProvider(name: ProviderName = "meta"): ProviderConfig {
  if (name === "baseten") {
    return {
      provider: name,
      baseUrl:
        process.env.BASETEN_BASE_URL?.trim() ||
        process.env.MODEL_BASE_URL?.trim() ||
        META_DEFAULT_BASE_URL,
      apiKey: process.env.BASETEN_API_KEY?.trim() || process.env.MODEL_API_KEY?.trim() || "",
      model: BASETEN_MODEL,
    };
  }
  return {
    provider: name,
    baseUrl: process.env.MODEL_BASE_URL?.trim() || META_DEFAULT_BASE_URL,
    apiKey: process.env.MODEL_API_KEY?.trim() || "",
    model: process.env.MODEL_ID?.trim() || META_DEFAULT_MODEL,
  };
}

/** Contributor-tier models must never run in production. */
export function assertUsableInProduction(config: ProviderConfig): void {
  if (process.env.NODE_ENV === "production" && isContributorModel(config.model)) {
    throw new Error(
      `Refusing to run: model "${config.model}" is a contributor-tier model, which must never run in production.`,
    );
  }
}
