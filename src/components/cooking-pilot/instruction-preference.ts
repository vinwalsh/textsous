/** Browser display preference only. Never part of a recipe, voice request,
 * cooking-plan identity, timing preference, or running session. */
export const INSTRUCTION_DETAIL_STORAGE_KEY = "sous:cooking:instruction-detail:v1";
export type InstructionDetail = "with-tips" | "essentials";

export function parseInstructionDetail(value: unknown): InstructionDetail {
  return value === "essentials" ? "essentials" : "with-tips";
}

export function readInstructionDetail(storage: Pick<Storage, "getItem"> | undefined): InstructionDetail {
  try { return parseInstructionDetail(storage?.getItem(INSTRUCTION_DETAIL_STORAGE_KEY)); }
  catch { return "with-tips"; }
}

export function saveInstructionDetail(storage: Pick<Storage, "setItem"> | undefined, value: InstructionDetail): boolean {
  if (!storage || (value !== "with-tips" && value !== "essentials")) return false;
  try { storage.setItem(INSTRUCTION_DETAIL_STORAGE_KEY, value); return true; }
  catch { return false; }
}
