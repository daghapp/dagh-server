/**
 * Shared query helpers for admin list endpoints (Phase 0).
 *
 * Every console list screen (visa, payments, users, tours, …) reuses the same
 * parsing rules so `page`/`limit`/`q`/`status`/`from`/`to` behave identically:
 *   - page defaults to 1 and is clamped to >= 1
 *   - limit defaults to 20 and is clamped to [1, 100]
 *   - `from`/`to` accept ISO date strings and are end-of-day inclusive for `to`
 */
export type QueryValue = string | string[] | undefined;

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

function firstValue(value: QueryValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parsePagination(query: Record<string, QueryValue>): PaginationParams {
  const pageRaw = parseInt(firstValue(query.page) ?? "", 10);
  const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
  const limitRaw = parseInt(firstValue(query.limit) ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  return { page, limit, skip: (page - 1) * limit };
}

export function parseSearch(query: Record<string, QueryValue>): string | undefined {
  const raw = firstValue(query.q)?.trim();
  return raw ? raw : undefined;
}

/**
 * Parse an enum filter (e.g. status/targetType). Returns undefined when absent,
 * empty, or not one of the allowed values — invalid filters are ignored rather
 * than erroring so a stray UI value can never 500 the list.
 */
export function parseEnum<T extends string>(
  query: Record<string, QueryValue>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const raw = firstValue(query[key])?.toUpperCase();
  if (!raw || raw === "ALL") return undefined;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms);
}

/**
 * Build an inclusive date-range predicate from `from`/`to` query params.
 * `to` is treated as the end of its day so `?to=2026-08-13` includes everything
 * through 23:59:59.999 on that date.
 */
export function parseDateRange(query: Record<string, QueryValue>): { gte?: Date; lte?: Date } {
  const from = parseDate(firstValue(query.from));
  const to = parseDate(firstValue(query.to));
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = from;
  if (to) {
    const endOfDay = new Date(to);
    endOfDay.setHours(23, 59, 59, 999);
    range.lte = endOfDay;
  }
  return range;
}
