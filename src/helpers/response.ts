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
  error: any;
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

export function fail(res: Response, status: number, error: any, details?: unknown): Response {
  const body: ErrorResponse = { success: false, error };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  message?: string,
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
  return res.json(body);
}
