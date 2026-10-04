import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The access-changed websocket event.
 *
 * Two properties are load-bearing, and they pull in opposite directions:
 *
 *   1. It is scoped to ONE user's sessions. The payload is an authorization
 *      decision, so broadcasting it would tell every connected client who has
 *      access to what. That is the failure a missing room name produces, and it
 *      looks like a working feature.
 *   2. It carries the whole snapshot. A partial payload is the more likely bug
 *      and the quieter one: the client is told to lock the feed and is given no
 *      `reason`, so it can render a lock but not a recovery — no "resubscribe",
 *      no "reconnect Google", just a dead end.
 */

const emit = vi.fn();
const toMock = vi.fn(() => ({ emit }));
const ioMock = { to: toMock };

// Mutable so a test can model "sockets not initialised yet" without re-importing
// the module under a second mock.
let currentIo: { to: typeof toMock } | null = ioMock;

vi.mock("../src/sockets/io.js", () => ({
  getIo: () => currentIo,
  userRoom: (userId: string) => `user:${userId}`,
}));

const { publishAccessChanged, COMMUNITY_ACCESS_CHANGED_EVENT } =
  await import("../src/helpers/community-events.js");

const OPEN = {
  channelId: "UC_target",
  status: "SUBSCRIBED" as const,
  hasChannelAccess: true,
  verifiedAt: "2026-09-30T09:00:00.000Z",
  accessExpiresAt: "2026-09-30T09:01:00.000Z",
  accessVersion: 7,
  requiresGoogleConnection: false,
  reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  currentIo = ioMock;
});

describe("publishAccessChanged", () => {
  it("goes only to that user's own sessions", () => {
    // The other rooms matter: broadcasting to "all connected clients" would
    // publish user-1's subscription to user-2, user-3 and every anonymous socket.
    publishAccessChanged("user-1", OPEN);

    expect(toMock).toHaveBeenCalledWith("user:user-1");
    expect(toMock).toHaveBeenCalledTimes(1);
  });

  it("carries the full decision, not just the fields needed to lock", () => {
    publishAccessChanged("user-1", {
      ...OPEN,
      status: "NOT_CONNECTED",
      hasChannelAccess: false,
      accessExpiresAt: null,
      accessVersion: 8,
      requiresGoogleConnection: true,
      reason: "GOOGLE_NOT_CONNECTED",
    });

    const [, event] = emit.mock.calls[0] as [string, Record<string, unknown>];

    // `reason` is the field a hand-assembled payload drops, and it is the one
    // that turns a lock into something the user can act on.
    expect(event).toMatchObject({
      type: COMMUNITY_ACCESS_CHANGED_EVENT,
      reason: "GOOGLE_NOT_CONNECTED",
      requiresGoogleConnection: true,
      accessVersion: 8,
      verifiedAt: "2026-09-30T09:00:00.000Z",
      accessExpiresAt: null,
    });
  });

  it("reports the version so a client can order it against what it already holds", () => {
    // A response that started before a revocation can land after the event that
    // revoked it. Without accessVersion the client cannot tell which is newer,
    // and re-applies the stale answer.
    publishAccessChanged("user-1", { ...OPEN, accessVersion: 12 });

    const [, event] = emit.mock.calls[0] as [string, Record<string, unknown>];

    expect(event.accessVersion).toBe(12);
  });

  it("never lets a delivery failure break the check that triggered it", async () => {
    // Revocation has already been committed to the database. If emitting threw,
    // the user would be unsubscribed on the server but still watching — the exact
    // state this whole feature exists to prevent. A missed event is a delay the
    // lease cleans up; a thrown event is a security hole.
    toMock.mockImplementation(() => {
      throw new Error("socket registry gone");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => publishAccessChanged("user-1", OPEN)).not.toThrow();

    errorSpy.mockRestore();
  });

  it("does nothing quietly when sockets are not initialised", () => {
    // Before `initIo` runs — in tests, and during a scripted migration — there is
    // no registry to publish to. Not an error, and emphatically not a reason to
    // throw: the access check that called this has already been committed.
    currentIo = null;

    expect(() => publishAccessChanged("user-1", OPEN)).not.toThrow();
    expect(toMock).not.toHaveBeenCalled();
  });
});
