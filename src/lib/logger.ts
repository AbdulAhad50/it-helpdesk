import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";

// Keys whose values must never reach logs. Personal data (names, descriptions, contact numbers)
// is deliberately not logged at all. Log complaintId and correlationId instead.
const REDACT = /pass(word)?|token|secret|authorization|cookie|private.?key|session|contact|description|username/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuse a well-formed incoming x-correlation-id, otherwise mint one. */
export function getCorrelationId(headers: Headers): string {
  const incoming = headers.get("x-correlation-id");
  return incoming && CORRELATION_PATTERN.test(incoming) ? incoming : randomUUID();
}
