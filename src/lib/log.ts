/** Structured server logs with redaction: recipe URLs never reach the logs. */

const URL_PATTERN = /https?:\/\/[^\s"']+/g;
const DATA_URL_PATTERN = /data:[a-z]+\/[a-z0-9.+-]+;base64,[^\s"']+/gi;

/** Deep copy with URLs and data URLs replaced. Non-strings pass through. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_PATTERN, "[url]").replace(DATA_URL_PATTERN, "[data]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry)]));
  }
  return value;
}

/** One JSON log line. Every field is redacted by construction. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...(redact(fields) as Record<string, unknown>) }));
}
