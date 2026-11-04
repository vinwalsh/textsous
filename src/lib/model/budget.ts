import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request model budget: an overall deadline and a record of whether any
 * model tokens may have been spent. Routes run the pipeline inside
 * runWithModelBudget; the CLI, eval and tests run without one (no deadline).
 */
export interface ModelBudget {
  /** Epoch ms after which no new stage or model call starts. */
  deadlineAt: number;
  /** True once a model call returned or timed out (tokens may be spent). */
  spent: boolean;
}

const storage = new AsyncLocalStorage<ModelBudget>();

/** Overall pipeline deadline, under the 300 s function limit. */
export const PIPELINE_DEADLINE_MS = 280_000;
/** Per model call HTTP timeout (the call also never outlives the deadline). */
export const MODEL_CALL_TIMEOUT_MS = 200_000;
/** A model call never starts with less than this left. */
export const MIN_CALL_MS = 15_000;

export class DeadlineError extends Error {
  code = "deadline" as const;
  constructor(stage: string) {
    super(
      `This recipe took too long to convert (stopped before the ${stage} step). ` +
        "Try again in a minute, or paste just the recipe text.",
    );
    this.name = "DeadlineError";
  }
}

export function runWithModelBudget<T>(
  fn: () => Promise<T>,
  opts: { deadlineMs?: number; now?: number } = {},
): { budget: ModelBudget; result: Promise<T> } {
  const budget: ModelBudget = {
    deadlineAt: (opts.now ?? Date.now()) + (opts.deadlineMs ?? PIPELINE_DEADLINE_MS),
    spent: false,
  };
  return { budget, result: storage.run(budget, fn) };
}

export function currentBudget(): ModelBudget | undefined {
  return storage.getStore();
}

/** Milliseconds left before the deadline, or Infinity without a budget. */
export function timeLeftMs(now = Date.now()): number {
  const budget = storage.getStore();
  return budget ? budget.deadlineAt - now : Number.POSITIVE_INFINITY;
}

/**
 * Refuse to start a stage that cannot finish before the deadline. minMs is
 * the stage's typical worst case (eval/RESULTS.md timings). No-op without a
 * budget.
 */
export function assertTimeFor(stage: string, minMs: number): void {
  if (timeLeftMs() < minMs) throw new DeadlineError(stage);
}

export function markSpent(): void {
  const budget = storage.getStore();
  if (budget) budget.spent = true;
}

/** Minimum time each stage needs before it may start. */
export const STAGE_MIN_MS = {
  canonicalize: 45_000,
  procedure: 60_000,
  review: 25_000,
  transcribe: 30_000,
  scaling: 15_000,
  dietary: 25_000,
  cuisine: 25_000,
  voice: 25_000,
} as const;
