import type { ReasoningEffort } from "./structured";

/**
 * reasoning_effort per model stage. Meta's default (high) made a fresh
 * conversion take 3-5 minutes, nearly all of it reasoning tokens, so every
 * stage sends an explicit, lower effort. Order of precedence for a stage:
 * an explicit reasoningEffort option, then a per-request override (the
 * preview-only header below), then REASONING_EFFORT_<STAGE> from the
 * environment, then the code default. Efforts are not part of the cache key
 * and never change a stage version.
 */
export const EFFORT_STAGES = [
  "overview",
  "canonicalize",
  "procedure",
  "review",
  "scaling",
  "dietary",
  "cuisine",
  "voice",
  "transcribe",
] as const;

export type EffortStage = (typeof EFFORT_STAGES)[number];

/** Per-request efforts by stage; stages left out use the env or code default. */
export type EffortOverrides = Partial<Record<EffortStage, ReasoningEffort>>;

/** Values the Meta Model API accepts for reasoning_effort. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const DEFAULT_EFFORTS: Readonly<Record<EffortStage, ReasoningEffort>> = {
  overview: "minimal",
  canonicalize: "low",
  // Measured on a preview (Nov 4): minimal writes the steps about twice as
  // fast as low (11-23 s vs 37-40 s) and its cook alongs passed the low-effort
  // review; a minimal review falsely blocked one, so review stays low.
  procedure: "minimal",
  review: "low",
  scaling: "minimal",
  dietary: "low",
  cuisine: "low",
  voice: "low",
  transcribe: "low",
};

/** Request header with per-stage efforts, e.g. "procedure=minimal,review=low". */
export const EFFORTS_HEADER = "x-textsous-efforts";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isEffortStage(value: string): value is EffortStage {
  return (EFFORT_STAGES as readonly string[]).includes(value);
}

/** Environment variable for a stage's effort, e.g. REASONING_EFFORT_PROCEDURE. */
export function effortEnvName(stage: EffortStage): string {
  return `REASONING_EFFORT_${stage.toUpperCase()}`;
}

/** The stage's effort from the environment; unset or not an accepted value -> undefined. */
export function envEffort(
  stage: EffortStage,
  env: Record<string, string | undefined> = process.env,
): ReasoningEffort | undefined {
  const raw = env[effortEnvName(stage)]?.trim().toLowerCase();
  return isReasoningEffort(raw) ? raw : undefined;
}

/** Effort for one stage: the override, then the environment, then the code default. */
export function effortFor(stage: EffortStage, overrides?: EffortOverrides): ReasoningEffort {
  const override = overrides?.[stage];
  if (isReasoningEffort(override)) return override;
  return envEffort(stage) ?? DEFAULT_EFFORTS[stage];
}

/**
 * Parse "procedure=minimal, review=low". Unknown stages, values the API does
 * not accept and malformed pairs are skipped.
 */
export function parseEffortOverrides(raw: string | null | undefined): EffortOverrides {
  const overrides: EffortOverrides = {};
  for (const pair of (raw ?? "").split(",")) {
    const [stage, value, extra] = pair.split("=").map((part) => part.trim().toLowerCase());
    if (extra !== undefined || !stage || !isEffortStage(stage) || !isReasoningEffort(value)) continue;
    overrides[stage] = value;
  }
  return overrides;
}

/**
 * Per-request efforts from the x-textsous-efforts header, for experiments on
 * Vercel preview deployments only. Production, local runs and anything else
 * without VERCEL_ENV=preview ignore the header. Returns undefined when there
 * is nothing to apply.
 */
export function requestEffortOverrides(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): EffortOverrides | undefined {
  if (env.VERCEL_ENV !== "preview") return undefined;
  const overrides = parseEffortOverrides(headers.get(EFFORTS_HEADER));
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
