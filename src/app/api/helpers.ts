import { NextResponse } from "next/server";
import { logEvent } from "../../lib/log";
import { limitBody, type DailyReservation, type LimitReason } from "../../lib/limits";
import { PIPELINE_DEADLINE_MS, runWithModelBudget } from "../../lib/model/budget";

/** JSON request bodies above this get 413 (convert, adjust, artifact). */
export const MAX_JSON_BYTES = 256 * 1024;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; status: 413 };

/**
 * Read a JSON body with a byte cap. Over the cap (by header or while
 * streaming) is 413; unparseable JSON comes back as value null so each route
 * keeps its own 400 message.
 */
export async function readJsonBody(req: Request, maxBytes = MAX_JSON_BYTES): Promise<JsonBody> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return { ok: false, status: 413 };
  const reader = req.body?.getReader();
  if (!reader) return { ok: true, value: null };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: true, value: null };
  }
}

export const TOO_LARGE_MESSAGE = "Request body is too large (256 KB max).";

/** Short machine code for an error, safe to log (no recipe content). */
export function errorCode(error: unknown, status: number): { errorClass: string; code: string } {
  const err = error as { name?: string; code?: unknown; status?: unknown; message?: unknown };
  const errorClass =
    error instanceof Error ? error.constructor?.name || error.name || "Error" : typeof error;
  const message = typeof err?.message === "string" ? err.message : "";
  let code = typeof err?.code === "string" ? err.code : "";
  if (!code && typeof err?.status === "number") code = `upstream_${err.status}`;
  if (!code) {
    if (/cut off at the length limit/i.test(message)) code = "length";
    else if (/failed validation|valid json|empty content/i.test(message)) code = "model_output";
    else if (/timed out|timeout/i.test(message)) code = "timeout";
    else if (/fetch failed|status \d+|resolve host|redirect|byte cap|content type/i.test(message)) {
      code = "page_fetch";
    } else if (/compile blocked/i.test(message)) code = "review_blocked";
    else if (/single-recipe/i.test(message)) code = "multiple_recipes";
    else if (/missing model api key/i.test(message)) code = "no_model_key";
    else code = `http_${status}`;
  }
  return { errorClass, code };
}

/**
 * Failure response with a structured log line (route, status, error class
 * and code; message redacted and truncated). Every non-2xx goes through here
 * so production problems are visible.
 */
export function fail(
  route: string,
  status: number,
  body: Record<string, unknown>,
  error?: unknown,
): NextResponse {
  const { errorClass, code } = error === undefined
    ? { errorClass: "none", code: typeof body.reason === "string" ? body.reason : `http_${status}` }
    : errorCode(error, status);
  const message = error instanceof Error ? error.message.slice(0, 160) : undefined;
  logEvent("request_failed", {
    route,
    status,
    errorClass,
    code,
    ...(message ? { detail: message } : {}),
  });
  return NextResponse.json(body, { status });
}

/** 429 per contract C2. */
export function limited(route: string, reason: LimitReason): NextResponse {
  return fail(route, 429, limitBody(reason));
}

/**
 * Run live model work under the pipeline deadline. A daily unit is kept only
 * once model tokens may have been spent: if the work throws or finishes
 * without any model call, the unit is given back.
 */
export async function runLive<T>(
  reservation: DailyReservation,
  fn: () => Promise<T>,
  /** Request start (epoch ms): the deadline counts the page fetch too. */
  startedAt?: number,
  /** Route deadline; defaults to PIPELINE_DEADLINE_MS (300 s routes). */
  deadlineMs: number = PIPELINE_DEADLINE_MS,
): Promise<T> {
  const elapsed = startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
  const { budget, result } = runWithModelBudget(fn, { deadlineMs: deadlineMs - elapsed });
  let value: T;
  try {
    value = await result;
  } catch (error) {
    if (!budget.spent) await reservation.release().catch(() => {});
    throw error;
  }
  if (!budget.spent) await reservation.release().catch(() => {});
  return value;
}

