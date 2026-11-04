import { after, NextResponse } from "next/server";
import { logEvent } from "../../lib/log";
import { limitBody, type DailyReservation, type LimitReason } from "../../lib/limits";
import { PIPELINE_DEADLINE_MS, runWithModelBudget } from "../../lib/model/budget";
import { CONVERT_EVENTS_MEDIA_TYPE, encodeEvent, type ConvertEvent } from "../../lib/convert-events";

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
  logFailure(route, status, body, error);
  return NextResponse.json(body, { status });
}

/**
 * The structured `request_failed` line alone, for failures that reach the
 * client another way (an `error` event at the end of a stream).
 */
export function logFailure(
  route: string,
  status: number,
  body: Record<string, unknown>,
  error?: unknown,
): void {
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
}

/**
 * Browsers label every request with Sec-Fetch-Site. A POST that another
 * site's page starts (a hidden form, a no-cors fetch) says "cross-site" and is
 * refused before any work, so other sites cannot post to these routes
 * directly. The app's own pages and the /embed iframe send "same-origin", so
 * a page that frames /embed still can start conversions of its own recipes,
 * bounded by the per-IP limit and the daily cap. curl, scripts and servers
 * send no header and pass.
 */
export function refuseCrossSite(route: string, req: Request): NextResponse | null {
  if (req.headers.get("sec-fetch-site")?.trim().toLowerCase() !== "cross-site") return null;
  return fail(route, 403, { error: "Requests from other websites are not accepted." });
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

/** True when the client asked for progress events (convert-events.ts). */
export function wantsEvents(req: Request): boolean {
  return (req.headers.get("accept") ?? "").toLowerCase().includes(CONVERT_EVENTS_MEDIA_TYPE);
}

export const EVENT_STREAM_HEADERS: Readonly<Record<string, string>> = {
  "content-type": `${CONVERT_EVENTS_MEDIA_TYPE}; charset=utf-8`,
  "cache-control": "no-store",
  "x-accel-buffering": "no",
};

/** A blank line this often keeps idle connections open; readers skip blank lines. */
export const EVENT_STREAM_HEARTBEAT_MS = 15_000;

/**
 * Keep the function alive until the work settles, even after the response
 * ends (a reader who closed the page). Outside a Next.js request (tests,
 * scripts) there is nothing to extend.
 */
function keepAlive(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // Not in a request scope.
  }
}

/**
 * A 200 NDJSON response, returned at once, that `run` fills with events.
 * The stream closes when `run` settles. If the client disconnects, writes
 * are dropped and the work goes on to the end (a URL conversion is still
 * cached). `run` reports its own failures as events; anything it throws is
 * swallowed here.
 */
export function eventStream(
  run: (send: (event: ConvertEvent) => void) => Promise<void>,
  heartbeatMs: number = EVENT_STREAM_HEARTBEAT_MS,
): Response {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  const write = (text: string): void => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      open = false;
    }
  };
  const heartbeat = setInterval(() => write("\n"), heartbeatMs);
  const work = Promise.resolve()
    .then(() => run((event) => write(encodeEvent(event))))
    .catch(() => {})
    .finally(() => {
      clearInterval(heartbeat);
      if (!open || !controller) return;
      open = false;
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    });
  keepAlive(work);
  return new Response(body, { status: 200, headers: { ...EVENT_STREAM_HEADERS } });
}
