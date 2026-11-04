import OpenAI from "openai";
import { z } from "zod";
import { toResponseJsonSchema } from "../schema/json";
import { assertUsableInProduction, resolveProvider, type ProviderName } from "./profiles";
import { DeadlineError, MIN_CALL_MS, MODEL_CALL_TIMEOUT_MS, markSpent, timeLeftMs } from "./budget";

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
      }, options?: { timeout?: number }): Promise<{
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
  /** reasoning_effort for the call; unset sends nothing (provider default, high on Meta). */
  reasoningEffort?: ReasoningEffort;
}

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

/** Timeouts may have spent tokens upstream; HTTP errors and refused connections did not. */
function mayHaveSpent(error: unknown): boolean {
  const err = error as { name?: string; constructor?: { name?: string } };
  const name = `${err?.name ?? ""} ${err?.constructor?.name ?? ""}`;
  return /Timeout|AbortError/i.test(name);
}

const CONCISE_RETRY =
  "Your previous reply was cut off at the length limit, so it was discarded. " +
  "Reply again with the complete JSON object, more concisely: short descriptions, " +
  "no repeated text, no extra whitespace. No prose.";

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
  // One SDK retry at most: a stage that times out twice would outlive the
  // route's 300 s limit.
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

  for (let validationAttempt = 0; ; validationAttempt += 1) {
    let content: string | null;
    let finishReason: string | null | undefined;
    const left = timeLeftMs();
    if (left < MIN_CALL_MS) throw new DeadlineError(opts.schemaName);
    try {
      attempts += 1;
      const response = await client.chat.completions.create(
        {
          model: config.model,
          messages: transcript,
          temperature,
          response_format: format,
          ...(opts.maxTokens !== undefined ? { max_completion_tokens: opts.maxTokens } : {}),
          ...(opts.reasoningEffort !== undefined ? { reasoning_effort: opts.reasoningEffort } : {}),
        },
        { timeout: Math.min(MODEL_CALL_TIMEOUT_MS, Math.floor(left)) },
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
      if (!fallbackUsed && isJsonSchemaRejection(error)) {
        fallbackUsed = true;
        format = { type: "json_object" };
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
