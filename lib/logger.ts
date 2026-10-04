/**
 * Minimal structured logger. Redacts keys that could carry secrets or
 * sensitive financial data so they never reach log output.
 */
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|otp|pin|cvv|card(number)?|account(number)?|amount|balance/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(process.env.NODE_ENV !== "production" ? { stack: value.stack } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, event: string, context?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = { level, event, time: new Date().toISOString(), ...(context ? (redact(context) as object) : {}) };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (e: string, c?: Record<string, unknown>) => log("debug", e, c),
  info: (e: string, c?: Record<string, unknown>) => log("info", e, c),
  warn: (e: string, c?: Record<string, unknown>) => log("warn", e, c),
  error: (e: string, c?: Record<string, unknown>) => log("error", e, c),
  redact,
};
