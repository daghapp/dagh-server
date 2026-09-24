// ─────────────────────────────────────────
// Community Video Feed — Structured Logging
// ─────────────────────────────────────────
// Every community feed / unlock / interaction endpoint reports its outcome as a
// single JSON line (one per request) so 404s, 500s, and slow calls are easy to
// grep. Event names use the `community.*` convention; level is chosen by the
// caller (info for happy paths, warn for expected client errors, error for
// server failures / unexpected exceptions).

interface LogContext {
  [key: string]: unknown;
}

function write(level: "log" | "warn" | "error", event: string, data: LogContext = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...data });
  if (level === "warn") console.warn(line);
  else if (level === "error") console.error(line);
  else console.log(line);
}

export function logCommunity(event: string, data: LogContext = {}): void {
  write("log", event, data);
}

export function logCommunityWarn(event: string, data: LogContext = {}): void {
  write("warn", event, data);
}

export function logCommunityError(event: string, data: LogContext = {}): void {
  write("error", event, data);
}