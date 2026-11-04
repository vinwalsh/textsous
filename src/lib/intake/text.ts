/** Same window the canonicalize stage reads; longer pastes are refused. */
export const MAX_TEXT_CHARS = 60_000;

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
      `Pasted text is too long (${rawText.length.toLocaleString("en-US")} characters; ` +
        `the limit is ${MAX_TEXT_CHARS.toLocaleString("en-US")}). ` +
        "Paste just one recipe: its title, ingredients and steps.",
    );
  }
  return { kind: "text", rawText };
}
