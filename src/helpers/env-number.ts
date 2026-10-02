// ─────────────────────────────────────────
// Numeric Environment Variables
// ─────────────────────────────────────────
// `Number(process.env.X || fallback)` looks safe and is not: any non-numeric
// value silently becomes NaN, and NaN then propagates into whatever consumes it
// — a Redis `PX` argument, a `new Date(now - NaN)` predicate, or a loop
// deadline, where `Date.now() >= NaN` is always false and the loop never exits.
//
// This reader clamps to an explicit range so a typo degrades to the default
// instead of corrupting a query or hanging a job.

/**
 * Reads a numeric env var, falling back to `fallback` when the value is absent,
 * blank, non-numeric, or outside [min, max].
 */
export function envNumber(
  name: string,
  fallback: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `[Config] ${name}="${raw}" is not a number; using the default ${fallback}.`,
    );
    return fallback;
  }

  if (parsed < min || parsed > max) {
    console.warn(
      `[Config] ${name}=${parsed} is outside [${min}, ${max}]; using the default ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}
