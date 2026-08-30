import type { CallStatus } from "../../generated/prisma/client.js";

/**
 * Allowed server-side call state transitions.
 *
 *   RINGING -> ANSWERED -> ENDED
 *   RINGING -> DECLINED
 *   RINGING -> CANCELLED
 *   RINGING -> MISSED
 *   RINGING / ANSWERED -> FAILED
 */
const VALID_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  INITIATING: ["RINGING", "FAILED"],
  RINGING: ["ANSWERED", "DECLINED", "CANCELLED", "MISSED", "FAILED"],
  ANSWERED: ["ENDED", "FAILED"],
  DECLINED: [],
  CANCELLED: [],
  MISSED: [],
  ENDED: [],
  FAILED: [],
};

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: CallStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}
