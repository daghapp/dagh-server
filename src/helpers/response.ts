/**
 * Standardized API response helpers.
 *
 * Phase 3.4 — The codebase had 11+ distinct response shapes across 22 controllers
 * (e.g. `{ success, message }`, `{ message }`, `{ error }`, `{ success, data }`).
 * These helpers enforce a single envelope:
 *
 *   Success:  { success: true,  data: T, message?: string }
 *   Error:    { success: false, error: string, details?: unknown }
 *   Paginated:{ success: true,  data: T[], pagination: { total, page, limit, totalPages } }
 *
 * Every controller now uses `ok()`, `created()`, `fail()`, or `paginated()` instead
 * of hand-rolled `res.json(...)` calls.
 */
import { Response } from "express";

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ErrorResponse {
  success: false;
  error: unknown;
  details?: unknown;
}

export interface PaginatedResponse<T = unknown> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  /**
   * Row-level context that describes the page as a whole rather than its items
   * — e.g. the community feed's `hasChannelAccess`, which tells the app the
   * whole page is unlocked without it having to inspect every card.
   */
  meta?: Record<string, unknown>;
  message?: string;
}

export function ok<T>(res: Response, data: T, message?: string): Response {
  const body: SuccessResponse<T> = { success: true, data };
  if (message) body.message = message;
  return res.json(body);
}

export function created<T>(res: Response, data: T, message?: string): Response {
  const body: SuccessResponse<T> = { success: true, data };
  if (message) body.message = message;
  return res.status(201).json(body);
}

export function fail(res: Response, status: number, error: unknown, details?: unknown): Response {
  const body: ErrorResponse = { success: false, error };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

/**
 * Marks a response as private and uncacheable, and returns it.
 *
 * Every response that varies by authenticated user is one a shared cache must not
 * keep: an unlock state served to the wrong person is an authorization decision
 * answered for someone else. Express sets no Cache-Control by default, so an
 * intermediary is free to cache a 200 and replay it to the next reader — which
 * for the community endpoints means serving one user's unlocked feed to another.
 *
 * `private` as well as `no-store` because the two answer different questions:
 * no-store forbids storing at all, private forbids a shared cache storing it
 * while leaving a browser's own copy alone.
 */
export function privateNoStore(res: Response): Response {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  return res;
}

export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  message?: string,
  meta?: Record<string, unknown>,
): Response {
  const body: PaginatedResponse<T> = {
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  return res.json(body);
}
