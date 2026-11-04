/** Browser-safe, lossless presentation metadata. The full instruction remains
 * canonical; a missing or stale classification always shows that full text. */
import { z } from "zod/v3";

export const instructionPartSchema = z.object({
  kind: z.enum(["essential", "explanation"]),
  text: z.string().min(1).max(20_000),
}).strict();
export type InstructionPart = z.infer<typeof instructionPartSchema>;
export const instructionPartsSchema = z.array(instructionPartSchema).min(1).max(100)
  .refine(parts => parts.some(part => part.kind === "essential" && part.text.trim().length > 0), "An instruction needs nonempty essential text");

export function isExactInstructionPartition(text: string, parts: unknown): parts is InstructionPart[] {
  const parsed = instructionPartsSchema.safeParse(parts);
  return parsed.success && parsed.data.map(part => part.text).join("") === text;
}

export function instructionDisplay(text: string, parts?: readonly InstructionPart[]): {
  essential: string; explanations: string[]; hasOptional: boolean;
} {
  if (!isExactInstructionPartition(text, parts)) return { essential: text, explanations: [], hasOptional: false };
  const explanations = parts.filter(part => part.kind === "explanation").map(part => part.text);
  return { essential: parts.filter(part => part.kind === "essential").map(part => part.text).join(""),
    explanations, hasOptional: explanations.some(value => value.trim().length > 0) };
}
