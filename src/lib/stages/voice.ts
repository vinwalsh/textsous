import { z } from "zod";
import type { TimelineDefinition, TimelineTask } from "../schema/timeline";
import {
  callStructured,
  type ProviderName,
  type StructuredChatClient,
  type TokenUsage,
} from "../model";
import { extractNumericTokens } from "../scaling/amounts";

export const VOICE_VERSION = 1;

export const VoiceRewriteSchema = z.strictObject({
  taskId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  completionCue: z.string().min(1),
});

export const VoiceRewritesSchema = z.strictObject({
  tasks: z.array(VoiceRewriteSchema).min(1),
});

export const VOICE_SCHEMA_NAME = "voice_rewrite_v1";

export type VoiceRewrite = z.infer<typeof VoiceRewriteSchema>;

export interface VoiceStats {
  rewritten: number;
  retried: number;
  keptOriginal: number;
}

export interface VoiceResult {
  timeline: TimelineDefinition;
  stats: VoiceStats;
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

function tokensMatch(a: string, b: string): boolean {
  const older = extractNumericTokens(a);
  const newer = extractNumericTokens(b);
  return older.length === newer.length && older.every((t, i) => t === newer[i]);
}

/** A rewrite is usable only when every field keeps its numeric tokens unchanged and in order. */
export function rewriteValid(
  original: Pick<TimelineTask, "label" | "description" | "completionCue">,
  rewritten: Pick<VoiceRewrite, "label" | "description" | "completionCue">,
): boolean {
  return (
    tokensMatch(original.label, rewritten.label) &&
    tokensMatch(original.description, rewritten.description) &&
    tokensMatch(original.completionCue, rewritten.completionCue)
  );
}

const SYSTEM_PROMPT = `You rewrite cooking instructions in SOUS's voice: a warm, encouraging sous-chef texting a home cook. Short sentences, second person, plain words, no emojis. Rewrite label, description and completionCue for every task.
CRITICAL: every numeric token (digits, decimals, fractions, quantities, times) must stay character-identical and in the same order within each field. Never add, remove, reorder or reformat a number.
Reply with only JSON matching the schema, no prose.`;

const RETRY_NOTE =
  "The previous rewrite for these tasks changed numbers. Rewrite again, keeping every number character-identical and in the same order within each field.";

function buildUserPrompt(
  tasks: Pick<TimelineTask, "id" | "label" | "description" | "completionCue">[],
  retry: boolean,
): string {
  return JSON.stringify({
    note: retry ? RETRY_NOTE : null,
    tasks: tasks.map((t) => ({
      taskId: t.id,
      label: t.label,
      description: t.description,
      completionCue: t.completionCue,
    })),
  });
}

interface RewriteCall {
  rewrites: VoiceRewrite[];
  usage: TokenUsage;
  fallbackUsed: boolean;
  attempts: number;
}

async function rewriteTasks(
  tasks: Pick<TimelineTask, "id" | "label" | "description" | "completionCue">[],
  retry: boolean,
  opts: { provider?: ProviderName; client?: StructuredChatClient },
): Promise<RewriteCall> {
  const result = await callStructured(
    VoiceRewritesSchema,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(tasks, retry) },
    ],
    { provider: opts.provider, schemaName: VOICE_SCHEMA_NAME, client: opts.client },
  );
  return {
    rewrites: result.data.tasks,
    usage: result.usage,
    fallbackUsed: result.fallbackUsed,
    attempts: result.attempts,
  };
}

/**
 * Rewrite a timeline's texts in SOUS's voice. Rewrites that change numeric
 * tokens are retried once (failed tasks only); persistent failures keep the
 * original text. Wording changes only.
 */
export async function voice(
  timeline: TimelineDefinition,
  opts: { provider?: ProviderName; client?: StructuredChatClient } = {},
): Promise<VoiceResult> {
  const byId = new Map(timeline.tasks.map((t) => [t.id, t] as const));
  const first = await rewriteTasks(timeline.tasks, false, opts);
  const failed = new Set<string>();
  const applied = new Map<string, VoiceRewrite>();
  const judge = (rewrites: VoiceRewrite[]): void => {
    for (const rewrite of rewrites) {
      const original = byId.get(rewrite.taskId);
      if (!original || applied.has(rewrite.taskId)) continue;
      if (rewriteValid(original, rewrite)) {
        applied.set(rewrite.taskId, rewrite);
        failed.delete(rewrite.taskId);
      } else {
        failed.add(rewrite.taskId);
      }
    }
  };
  judge(first.rewrites);
  for (const task of timeline.tasks) {
    if (!applied.has(task.id)) failed.add(task.id);
  }

  let usage = first.usage;
  let fallbackUsed = first.fallbackUsed;
  let attempts = first.attempts;
  let retried = 0;
  if (failed.size > 0) {
    const retryTasks = timeline.tasks.filter((t) => failed.has(t.id));
    retried = retryTasks.length;
    const second = await rewriteTasks(retryTasks, true, opts);
    judge(second.rewrites);
    usage = {
      promptTokens: usage.promptTokens + second.usage.promptTokens,
      completionTokens: usage.completionTokens + second.usage.completionTokens,
      totalTokens: usage.totalTokens + second.usage.totalTokens,
    };
    fallbackUsed = fallbackUsed || second.fallbackUsed;
    attempts += second.attempts;
  }

  const tasks = timeline.tasks.map((task) => {
    const rewrite = applied.get(task.id);
    if (!rewrite) return task;
    return { ...task, label: rewrite.label, description: rewrite.description, completionCue: rewrite.completionCue };
  });
  return {
    timeline: { ...timeline, tasks },
    stats: { rewritten: applied.size, retried, keptOriginal: timeline.tasks.length - applied.size },
    usage,
    fallbackUsed,
    attempts,
  };
}
