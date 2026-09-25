import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

/**
 * Assigns a correlation id to every request.
 *
 * Honours an inbound `X-Request-Id` so a mobile client (or an upstream proxy)
 * can supply its own trace id, otherwise generates a UUID. The value is
 * attached to `req.requestId` and echoed on the response so an admin can quote
 * it in a support request and have it match the server logs and audit records.
 *
 * The inbound value is validated against a conservative character set — it ends
 * up in log lines, so an unvalidated header would be a log-injection vector.
 */
const INBOUND_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export default function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header("x-request-id");
  const id = inbound && INBOUND_PATTERN.test(inbound) ? inbound : randomUUID();

  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
