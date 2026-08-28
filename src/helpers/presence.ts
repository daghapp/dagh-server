import { getRedisClient } from "../config/redis.js";
import { prisma } from "../config/index.js";

const presenceKey = (userId: string) => `presence:user:${userId}`;
const PRESENCE_TTL_SEC = 12 * 60 * 60;

// Per-process cache of online sockets. Always updated so presence:check stays
// fast in single-instance mode; when Redis is available it is mirrored there so
// presence is shared across instances.
const onlineUsers = new Map<string, Set<string>>();

export function isOnlineLocal(userId: string): boolean {
  return (onlineUsers.get(userId)?.size ?? 0) > 0;
}

export async function markOnline(userId: string, socketId: string): Promise<void> {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId)!.add(socketId);

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.sAdd(presenceKey(userId), socketId);
    await redis.expire(presenceKey(userId), PRESENCE_TTL_SEC);
  } catch (error) {
    console.error("[presence] markOnline redis error:", error);
  }
}

export async function markOffline(userId: string, socketId: string): Promise<boolean> {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(userId);
  }

  const redis = getRedisClient();
  if (!redis) return !isOnlineLocal(userId);

  try {
    await redis.sRem(presenceKey(userId), socketId);
    const remaining = await redis.sCard(presenceKey(userId));
    if (remaining === 0) await redis.del(presenceKey(userId));
    return remaining === 0;
  } catch (error) {
    console.error("[presence] markOffline redis error:", error);
    return !isOnlineLocal(userId);
  }
}

export async function isOnline(userId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return isOnlineLocal(userId);
  try {
    const count = await redis.sCard(presenceKey(userId));
    return count > 0;
  } catch (error) {
    console.error("[presence] isOnline redis error:", error);
    return isOnlineLocal(userId);
  }
}

/**
 * Users who should be told when this user comes online / goes offline:
 * conversation participants and active matches. Keeps presence fan-out O(peers)
 * instead of O(all connected sockets).
 */
export async function getPresenceAudience(userId: string): Promise<string[]> {
  try {
    const [conversations, matches] = await Promise.all([
      prisma.conversation.findMany({
        where: { participants: { has: userId } },
        select: { participants: true },
      }),
      prisma.userMatch.findMany({
        where: {
          OR: [{ userId }, { matchedId: userId }],
          status: "MATCHED",
        },
        select: { userId: true, matchedId: true },
      }),
    ]);

    const peers = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants) {
        if (participant !== userId) peers.add(participant);
      }
    }
    for (const match of matches) {
      if (match.userId !== userId) peers.add(match.userId);
      if (match.matchedId !== userId) peers.add(match.matchedId);
    }
    return [...peers];
  } catch (error) {
    console.error("[presence] getPresenceAudience error:", error);
    return [];
  }
}
