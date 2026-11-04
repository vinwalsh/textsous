import OpenAI, { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { z } from "zod";
import { toResponseJsonSchema } from "../schema/json";
import { assertUsableInProduction, resolveProvider, type ProviderName } from "./profiles";
import {
  DeadlineError,
  MIN_CALL_MS,
  MODEL_CALL_TIMEOUT_MS,
  ModelTimeoutError,
  markSpent,
  timeLeftMs,
} from "./budget";

export interface ChatTextContentPart {
  type: "text";
  text: string;
}

export interface ChatImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export type ChatContentPart = ChatTextContentPart | ChatImageContentPart;

export interface ChatSystemMessage {
  role: "system";
  content: string;
}

/**
 * User message. Images go only here, as image_url data URLs (photo intake),
 * per the non-negotiables; every other stage sends plain strings.
 */
export interface ChatUserMessage {
  role: "user";
  content: string | ChatContentPart[];
}

export interface ChatAssistantMessage {
  role: "assistant";
  content: string;
}

/** Chat message: images are only allowed on user messages. */
export type ChatTextMessage = ChatSystemMessage | ChatUserMessage | ChatAssistantMessage;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  provider: ProviderName;
  fallbackUsed: boolean;
  attempts: number;
  /** Verbatim content of the successful completion (for --record). */
  rawContent: string;
}

/** Minimal chat-completions client shape, so tests can inject a fake transport. */
export interface StructuredChatClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: ChatTextMessage[];
        temperature: number;
        response_format: ResponseFormat;
        max_completion_tokens?: number;
        reasoning_effort?: ReasoningEffort;
      }, options?: { timeout?: number; maxRetries?: number }): Promise<{
        choices: Array<{ message: { content: string | null }; finish_reason?: string | null }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        } | null;
      }>;
    };
  };
}

export interface CallStructuredOptions {
  provider?: ProviderName;
  schemaName: string;
  temperature?: number;
  /** Validation re-prompts after the first attempt. Default 2. */
  maxValidationRetries?: number;
  /** Fake transport for tests. Defaults to a live OpenAI client. */
  client?: StructuredChatClient;
  /** Cap on completion tokens (max_completion_tokens). Unset by default. */
  maxTokens?: number;
  /**
   * reasoning_effort for the call; unset sends nothing (provider default,
   * high on Meta). Stages pass effortFor(stage) from ./efforts. A provider
   * that rejects the value gets the call again without it.
   */
  reasoningEffort?: ReasoningEffort;
  /** Pause before the one manual retry of a transient upstream error. Default 1500 ms. */
  retryDelayMs?: number;
}

/** Pause before retrying a transient upstream error by hand. */
export const TRANSIENT_RETRY_DELAY_MS = 1_500;

/** Values the Meta Model API accepts for reasoning_effort. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

type ResponseFormat =
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown> } }
  | { type: "json_object" };

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * An error's class names, for errors that are not the SDK's own classes
 * (test doubles, DOM AbortError). The SDK classes are matched with
 * instanceof: the SDK never sets `.name`, and a production build renames
 * classes, so their names are not "APIConnectionError" there.
 */
function errorNames(error: unknown): string {
  const err = error as { name?: string; constructor?: { name?: string } };
  return `${err?.name ?? ""} ${err?.constructor?.name ?? ""}`;
}

/** The SDK's own per-call timeout (APIConnectionTimeoutError, "Request timed out."). */
function isCallTimeout(error: unknown): boolean {
  if (error instanceof APIConnectionTimeoutError) return true;
  const message = (error as { message?: string })?.message ?? "";
  return /Timeout/i.test(errorNames(error)) || /^request timed out/i.test(message);
}

/** Timeouts may have spent tokens upstream; HTTP errors and refused connections did not. */
function mayHaveSpent(error: unknown): boolean {
  return isCallTimeout(error) || /Timeout|AbortError/i.test(errorNames(error));
}

/**
 * A fast upstream failure worth one more try: HTTP 429 or 5xx, or a dropped
 * connection (APIConnectionError). Never a timeout: that call was slow, and
 * a second one would run into the deadline.
 */
function isTransient(error: unknown): boolean {
  if (mayHaveSpent(error)) return false;
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return error instanceof APIConnectionError || /APIConnectionError/.test(errorNames(error));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CONCISE_RETRY =
  "Your previous reply was cut off at the length limit, so it was discarded. " +
  "Reply again with the complete JSON object, more concisely: short descriptions, " +
  "no repeated text, no extra whitespace. No prose.";

/**
 * Per-call HTTP options. The SDK retry is allowed only when a second full
 * attempt still fits before the deadline; under a request budget it never
 * does, so a slow call cannot run the function past its limit.
 */
export function callOptions(left: number): { timeout: number; maxRetries: number } {
  const timeout = Math.min(MODEL_CALL_TIMEOUT_MS, Math.floor(left));
  return { timeout, maxRetries: left >= 2 * timeout + MIN_CALL_MS ? 1 : 0 };
}

/**
 * A 400 or 422 naming reasoning_effort: the model or provider does not take
 * the effort sent. The call is repeated once without it (provider default)
 * rather than failing a conversion over a tuning parameter.
 */
function isEffortRejection(error: unknown): boolean {
  const err = error as { status?: number; message?: string; error?: { message?: string } };
  if (err?.status !== 400 && err?.status !== 422) return false;
  const message = `${err?.message ?? ""} ${err?.error?.message ?? ""}`.toLowerCase();
  return message.includes("reasoning_effort") || message.includes("reasoning effort");
}

function isJsonSchemaRejection(error: unknown): boolean {
  const err = error as { status?: number; message?: string; error?: { message?: string } };
  const status = err?.status;
  if (status !== 400 && status !== 422) return false;
  const message = `${err?.message ?? ""} ${err?.error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("json_schema") ||
    message.includes("json schema") ||
    message.includes("response_format") ||
    message.includes("response format") ||
    message.includes("structured") ||
    message.includes("strict")
  );
}

/**
 * One structured model call (Chat Completions API). Prefers
 * `response_format: json_schema`, falls back to JSON mode when the provider
 * rejects json_schema, validates with zod, and re-prompts with the
 * validation errors up to 2 times. The schema is never loosened.
 */
export async function callStructured<T>(
  zodSchema: z.ZodType<T>,
  messages: ChatTextMessage[],
  opts: CallStructuredOptions,
): Promise<StructuredResult<T>> {
  const providerName = opts.provider ?? "meta";
  const config = resolveProvider(providerName);
  assertUsableInProduction(config);
  if (!config.apiKey) {
    throw new Error("Missing model API key: set MODEL_API_KEY in the environment.");
  }
  const maxValidationRetries = opts.maxValidationRetries ?? 2;
  const temperature = opts.temperature ?? 0;

  // Explicit global fetch: honors proxy env (NODE_USE_ENV_PROXY) everywhere.
  // One SDK retry at most, and only without a route deadline (callOptions).
  const client: StructuredChatClient =
    opts.client ??
    (new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      fetch: globalThis.fetch,
      timeout: MODEL_CALL_TIMEOUT_MS,
      maxRetries: 1,
      // The SDK's reasoning_effort type predates "minimal" and "xhigh",
      // which the Meta Model API accepts.
    }) as unknown as StructuredChatClient);
  const jsonSchema = toResponseJsonSchema(zodSchema as z.ZodTypeAny);

  let format: ResponseFormat = {
    type: "json_schema",
    json_schema: { name: opts.schemaName, schema: jsonSchema },
  };
  let fallbackUsed = false;
  const transcript: ChatTextMessage[] = [...messages];
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let attempts = 0;
  let lengthRetried = false;
  let transientRetried = false;
  let reasoningEffort = opts.reasoningEffort;
  const retryDelayMs = opts.retryDelayMs ?? TRANSIENT_RETRY_DELAY_MS;

  for (let validationAttempt = 0; ; validationAttempt += 1) {
    let content: string | null;
    let finishReason: string | null | undefined;
    const left = timeLeftMs();
    if (left < MIN_CALL_MS) throw new DeadlineError(opts.schemaName);
    const http = callOptions(left);
    try {
      attempts += 1;
      const response = await client.chat.completions.create(
        {
          model: config.model,
          messages: transcript,
          temperature,
          response_format: format,
          ...(opts.maxTokens !== undefined ? { max_completion_tokens: opts.maxTokens } : {}),
          ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
        },
        http,
      );
      markSpent();
      const u = response.usage;
      if (u) {
        usage = addUsage(usage, {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        });
      }
      content = response.choices[0]?.message?.content ?? null;
      finishReason = response.choices[0]?.finish_reason;
    } catch (error) {
      if (mayHaveSpent(error)) markSpent();
      if (reasoningEffort !== undefined && isEffortRejection(error)) {
        reasoningEffort = undefined;
        validationAttempt -= 1;
        continue;
      }
      if (!fallbackUsed && isJsonSchemaRejection(error)) {
        fallbackUsed = true;
        format = { type: "json_object" };
        continue;
      }
      if (isCallTimeout(error)) throw new ModelTimeoutError();
      // Under a route deadline the SDK never retries (callOptions), so one
      // upstream 429/503 or dropped connection would end a conversion that
      // may have run for minutes. Retry once by hand when time allows.
      if (
        !transientRetried &&
        http.maxRetries === 0 &&
        isTransient(error) &&
        timeLeftMs() >= MIN_CALL_MS + retryDelayMs + 2_000
      ) {
        transientRetried = true;
        await sleep(retryDelayMs);
        validationAttempt -= 1;
        continue;
      }
      throw error;
    }

    if (finishReason === "length") {
      // Truncated JSON is never re-prompted as if it were an answer: drop it
      // and ask once for a more concise complete reply.
      if (lengthRetried) {
        throw new Error(
          "Model reply was cut off at the length limit twice (finish_reason length).",
        );
      }
      lengthRetried = true;
      transcript.push({ role: "user", content: CONCISE_RETRY });
      validationAttempt -= 1;
      continue;
    }
    if (content === null || content.trim() === "") {
      throw new Error("Model returned empty content.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      if (validationAttempt >= maxValidationRetries) {
        throw new Error("Model did not return valid JSON after retries.");
      }
      transcript.push({ role: "assistant", content });
      transcript.push({
        role: "user",
        content: "That was not valid JSON. Reply with only the corrected JSON object, no prose.",
      });
      continue;
    }
    const result = zodSchema.safeParse(parsed);
    if (result.success) {
      return {
        data: result.data,
        usage,
        model: config.model,
        provider: providerName,
        fallbackUsed,
        attempts,
        rawContent: content,
      };
    }
    if (validationAttempt >= maxValidationRetries) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`Model output failed validation after ${attempts} attempt(s): ${issues}`);
    }
    transcript.push({ role: "assistant", content });
    transcript.push({
      role: "user",
      content:
        "That JSON failed validation. Fix ONLY the reported errors and reply with the full " +
        `corrected JSON object, no prose. Errors: ${JSON.stringify(result.error.issues)}`,
    });
  }
}
