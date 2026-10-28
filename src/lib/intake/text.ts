export const MAX_TEXT_CHARS = 100_000;

export interface TextExtraction {
  kind: "text";
  rawText: string;
}

export function extractFromText(input: string): TextExtraction {
  const rawText = input.replace(/\r\n?/g, "\n").trim();
  if (!rawText) {
    throw new Error("No text provided: paste a recipe to convert.");
  }
  if (rawText.length > MAX_TEXT_CHARS) {
    throw new Error(
      `Pasted text is too long (${rawText.length} chars, max ${MAX_TEXT_CHARS}).`,
    );
  }
  return { kind: "text", rawText };
}
