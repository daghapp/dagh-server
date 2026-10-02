// ─────────────────────────────────────────
// Community access change events
// ─────────────────────────────────────────
// When a re-check concludes that access should change, the client that caused the
// check already has the answer. The clients that need telling are the OTHER
// ones: the same user's phone on the sofa, a tablet with the feed open, a session
// that was mid-poll when the verdict landed.
//
// This delivers that. Scope is deliberately narrow — one room, one event, one
// user's own sessions — because the payload is an authorization decision and
// broadcasting it would leak who has access to what.
//
// What this is NOT: a subscription to YouTube. It does not make an unsubscribe
// arrive faster, and it cannot deliver anything to a client that is offline or
// backgrounded. It distributes a discovery the server has already made. That is
// why the access lease exists and why it is the real guarantee: if this event is
// missed, the next check still closes the feed. The event is an optimisation on
// top of a guarantee, and the frontend work has to treat it as such — a client
// that only ever listens for this event, and never checks a lease, is not
// correct.

import { getIo, userRoom } from "../sockets/io.js";
import { ChannelAccessStatus } from "../../generated/prisma/client.js";
import type { ChannelAccessSnapshot } from "../services/channel-access.service.js";

export const COMMUNITY_ACCESS_CHANGED_EVENT = "community.access.changed";

export interface AccessChangedEvent {
  type: typeof COMMUNITY_ACCESS_CHANGED_EVENT;
  channelId: string;
  hasChannelAccess: boolean;
  status: ChannelAccessStatus;
  /**
   * Monotonic per user/channel. The client applies an event only if it is newer
   * than what it already holds — arrival order is not evidence of freshness, and
   * a request that started before a revocation can complete after it.
   */
  accessVersion: number;
  /**
   * The rest of the decision, so a client that is told to lock can also say why
   * without a second round trip. Carried rather than fetched deliberately: the
   * alternative is a client that knows it lost access but not whether to show
   * "resubscribe", "reconnect Google", or "we could not check", which is the
   * difference between a user who can fix it and a support ticket.
   */
  verifiedAt: string | null;
  accessExpiresAt: string | null;
  requiresGoogleConnection: boolean;
  reason: ChannelAccessSnapshot["reason"];
}

/**
 * Sends the event to every connected session of one app user.
 *
 * Takes the `ChannelAccessSnapshot` rather than a hand-picked subset. That is
 * the load-bearing choice: a caller assembling its own payload can emit a
 * `status` and a `hasChannelAccess` that disagree, or omit `reason` entirely,
 * and the client has no way to notice — the two ends of this event are the two
 * ends of an authorization decision. Passing the snapshot the access service
 * already built makes that class of bug unrepresentable.
 *
 * Best effort by design. A failure here means a client will not hear about a
 * revocation until its next poll or lease expiry — a delay, not a security
 * boundary — so it is logged and swallowed rather than allowed to fail the
 * request that triggered the check. Making revocation depend on a websocket
 * would mean a socket hiccup keeps an unsubscribed user watching.
 */
export function publishAccessChanged(userId: string, access: ChannelAccessSnapshot): void {
  const io = getIo();
  if (!io) return;

  try {
    io.to(userRoom(userId)).emit(COMMUNITY_ACCESS_CHANGED_EVENT, {
      type: COMMUNITY_ACCESS_CHANGED_EVENT,
      channelId: access.channelId,
      hasChannelAccess: access.hasChannelAccess,
      status: access.status,
      accessVersion: access.accessVersion,
      verifiedAt: access.verifiedAt,
      accessExpiresAt: access.accessExpiresAt,
      requiresGoogleConnection: access.requiresGoogleConnection,
      reason: access.reason,
    } satisfies AccessChangedEvent);
  } catch (error) {
    console.error(
      `[Community Access] Could not deliver access change for user ${userId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
