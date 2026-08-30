import { prisma } from "../config/index.js";
import type { CallStatus } from "../../generated/prisma/client.js";
import { canTransition } from "./callTransitions.js";

export { canTransition, isTerminal } from "./callTransitions.js";

export interface CallTransitionUpdates {
  endedAt?: Date;
  endedBy?: string;
  failureReason?: string;
  answeredAt?: Date;
  ringingAt?: Date;
  durationSec?: number;
}

/**
 * Atomically transition a call to a new status within a transaction.
 * Uses Prisma interactive transaction for atomicity. Returns the updated
 * call if the transition succeeded, or null if the current status didn't
 * match expectedCurrentStatus (safe no-op for idempotent callers).
 */
export async function transitionCall(
  callId: string,
  expectedCurrentStatus: CallStatus | CallStatus[],
  newStatus: CallStatus,
  updates: CallTransitionUpdates,
  actorId: string,
  requestId?: string,
): Promise<import("../../generated/prisma/client.js").Call | null> {
  const expectedStatuses = Array.isArray(expectedCurrentStatus)
    ? expectedCurrentStatus
    : [expectedCurrentStatus];

  return prisma.$transaction(async (tx) => {
    // Lock the row with SELECT ... FOR UPDATE to prevent concurrent transitions
    const rows = await tx.$queryRaw<
      { id: string; status: CallStatus; version: number }[]
    >`SELECT id, status, version FROM calls WHERE id = ${callId} FOR UPDATE`;

    if (rows.length === 0) return null;

    const call = rows[0];

    // Verify current status matches one of the expected statuses
    if (!expectedStatuses.includes(call.status)) {
      return null;
    }

    // Verify transition is allowed
    if (!canTransition(call.status, newStatus)) {
      return null;
    }

    // Perform the update
    const updated = await tx.call.update({
      where: { id: callId },
      data: {
        status: newStatus,
        version: { increment: 1 },
        ...updates,
      },
    });

    // Write audit log
    await tx.callAuditLog.create({
      data: {
        callId,
        actorId,
        priorState: call.status,
        newState: newStatus,
        requestId: requestId ?? null,
      },
    });

    return updated;
  });
}
