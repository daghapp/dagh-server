// ─────────────────────────────────────────
// YouTube verification — single-use OAuth state
// ─────────────────────────────────────────
// The subscription check runs its own OAuth round-trip, separate from app login,
// and the browser that carries it out is the system browser. That is the whole
// reason this exists rather than reusing express-session the way app login does:
//
//   - the system browser does not share the app's cookie jar, so a session cookie
//     set by our origin is frequently simply absent on the callback;
//   - a state token bound to a cookie is therefore not a bound at all.
//
// So the pending round-trip is held server-side, keyed by an unguessable token
// the app receives and hands to Google. Consuming it is a delete, so a replayed
// callback finds nothing and cannot re-verify or re-link anything.
//
// What the token binds, and why each field earns its place:
//
//   appUserId    the app account the verdict will be written to. Taken from the
//                authenticated request that started the flow, never from the
//                callback query — otherwise account A's callback could credit
//                account B.
//   channelId    the target channel the check will run against, pinned at
//                initiation so a config change mid-flow cannot make the callback
//                verify a different channel than the one the user consented for.
//   nonce        bound into the id_token request and re-checked against the
//                `nonce` claim, so a token minted for a different round-trip
//                cannot be replayed at this callback.
//   returnUrl    the app destination to hand control back to. Allowlist-checked
//                before it is stored; a callback never supplies its own.
//   sessionId    an opaque id for the app session that started the flow, so a
//                verdict landing after the user logged out and someone else
//                logged in can be recognised as belonging to a session that no
//                longer exists.
//
// Storage is Redis-first with a bounded in-memory fallback, matching the pattern
// used elsewhere in this codebase: a single-instance deployment without REDIS_URL
// still gets single-use semantics for the life of the process.

import crypto from "node:crypto";
import { getRedisClient } from "../config/redis.js";
import type { RedisClientType } from "redis";

const STATE_PREFIX = "yt:verify:state:";
const STATE_TTL_SECONDS = 15 * 60; // short-lived: 15 minutes

// Bounds the in-memory fallback. Redis deployments never touch this. A dev box
// with no Redis and a flood of abandoned flows would otherwise grow without
// limit; evicting the oldest entry is the right trade because the states it
// drops are exactly the expired or abandoned ones.
const MAX_IN_MEMORY_STATES = 500;

export interface VerifyStateRecord {
  appUserId: string;
  channelId: string;
  nonce: string;
  returnUrl: string;
  sessionId: string;
  /** Internal card id the flow started from, for the funnel's UNLOCK event. */
  videoId: string;
  createdAt: number;
}

const inMemoryStates = new Map<string, VerifyStateRecord>();

export function verifyStateKey(token: string): string {
  return `${STATE_PREFIX}${token}`;
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function newSessionId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export async function storeVerifyState(
  record: Omit<VerifyStateRecord, "createdAt">,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const full: VerifyStateRecord = { ...record, createdAt: Date.now() };

  const redis = getRedisClient() as RedisClientType | null;
  if (redis) {
    await redis.set(verifyStateKey(token), JSON.stringify(full), {
      EX: STATE_TTL_SECONDS,
      NX: true,
    });
    return token;
  }

  if (inMemoryStates.size >= MAX_IN_MEMORY_STATES) {
    const oldest = inMemoryStates.keys().next();
    if (!oldest.done) inMemoryStates.delete(oldest.value);
  }
  inMemoryStates.set(token, full);
  return token;
}

/**
 * Reads and consumes a pending round-trip.
 *
 * The delete is what makes the state single-use, and it is deliberately not
 * conditional on the caller's identity matching: a callback carrying a valid
 * token but the wrong account still burns it, so an attacker who intercepted one
 * cannot keep retrying until the real user arrives.
 *
 * Returns null for unknown, expired or already-consumed tokens.
 */
export async function consumeVerifyState(token: string): Promise<VerifyStateRecord | null> {
  const key = verifyStateKey(token);

  const redis = getRedisClient() as RedisClientType | null;
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);
    return parseState(raw);
  }

  const record = inMemoryStates.get(token);
  if (!record) return null;
  inMemoryStates.delete(token);
  if (Date.now() - record.createdAt > STATE_TTL_SECONDS * 1000) return null;
  return record;
}

function parseState(raw: string): VerifyStateRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<VerifyStateRecord>;
    if (
      typeof parsed.appUserId !== "string" ||
      typeof parsed.channelId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.returnUrl !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.videoId !== "string"
    ) {
      return null;
    }
    return {
      appUserId: parsed.appUserId,
      channelId: parsed.channelId,
      nonce: parsed.nonce,
      returnUrl: parsed.returnUrl,
      sessionId: parsed.sessionId,
      videoId: parsed.videoId,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    };
  } catch {
    // A poisoned or truncated entry is indistinguishable from an absent one, and
    // treating it as absent is the only safe answer: the flow simply did not
    // happen as far as the caller is concerned.
    return null;
  }
}

/** Test helper: clears the in-memory fallback so cases do not leak into each other. */
export function _resetInMemoryVerifyStates(): void {
  inMemoryStates.clear();
}
