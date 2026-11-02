/**
 * One-word failure labels for eval rows. Raw messages stay on the console;
 * the file keeps only the label (and never third-party text).
 */
export function classifyError(message: string): string {
  if (
    /timed out|fetch failed|byte cap|content type|resolve host|redirect|status \d+|only https|private-network|credentials|invalid url/i.test(
      message,
    )
  ) {
    return "fetch-error";
  }
  if (/single-recipe|compile blocked/i.test(message)) return "review-blocked";
  if (/validation|valid json|empty content|connection error|^\d{3}[\s:]/i.test(message)) {
    return "model-error";
  }
  if (/missing model api key/i.test(message)) return "config-error";
  return "unknown-error";
}
