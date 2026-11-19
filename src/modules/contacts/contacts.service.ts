import type { Prisma } from "../../../generated/prisma/client.js";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "../../config/index.js";
import {
  hashPhoneCandidates,
  hashPhoneNumber,
  normalizePhoneNumber,
  phoneDigitCandidates,
} from "../../helpers/phoneHash.js";
import * as deepLinkService from "../deep-links/deep-link.service.js";

export interface ContactInput {
  name?: string;
  phone?: string;
  phoneNumber?: string;
  hash?: string;
  phoneHash?: string;
  email?: string;
}

export interface ContactMatch {
  userId: string;
  name: string | null;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  headline: string | null;
  hasDatingProfile: boolean;
}

export const contactUserSelect = {
  id: true,
  fullName: true,
  username: true,
  phoneNumber: true,
  phoneNumberHash: true,
  phoneHash: true,
  profileImageUrl: true,
  profile: { select: { bio_profile_image_url: true, profileUrl: true } },
  datingProfile: { select: { headline: true, photos: true } },
} as const;

export type ContactUser = Prisma.UserGetPayload<{ select: typeof contactUserSelect }>;

const API_BASE_URL = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(
  /\/$/,
  "",
);

export function hashPhone(phone: string | null | undefined): string {
  return hashPhoneNumber(phone);
}
export const hashContacts = hashContactsList;
export const hashPhoneNumbers = hashContactsList;
export function hashContact(phone: string | null | undefined): string {
  return hashPhoneNumber(phone);
}

export function normalizePhone(phone: string | null | undefined): string {
  return normalizePhoneNumber(phone);
}

/**
 * Store every plausible hash form of a user's phone number. This allows
 * contacts sent as pre-computed hashes (which cannot be expanded) to match
 * regardless of which format the client hashed.
 */
export async function syncPhoneHashVariants(
  userId: string,
  phone: string | null | undefined,
): Promise<void> {
  const hashes = hashPhoneCandidates(phone);
  if (hashes.length === 0) return;

  try {
    await prisma.phoneHashVariant.deleteMany({ where: { userId } });
    await prisma.phoneHashVariant.createMany({
      data: hashes.map((hash) => ({ userId, hash })),
      skipDuplicates: true,
    });
  } catch (error) {
    // Best-effort: table may be missing before migration; hash columns still work.
    console.warn("[contacts] failed to sync phone hash variants", { userId, error });
  }
}

function pushPhone(out: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@")) return;
  out.push(trimmed);
}

function pushEmail(out: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+$/.test(trimmed)) out.push(trimmed);
}

function extractPhones(contacts: Array<ContactInput | string>): string[] {
  const out: string[] = [];
  for (const c of contacts || []) {
    if (typeof c === "string") {
      pushPhone(out, c);
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const record = c as Record<string, unknown>;

    for (const key of ["phone", "phoneNumber", "number", "digits", "hash", "phoneHash"]) {
      pushPhone(out, record[key]);
    }

    const phoneNumbers = record.phoneNumbers;
    if (Array.isArray(phoneNumbers)) {
      for (const entry of phoneNumbers) {
        if (typeof entry === "string") pushPhone(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushPhone(out, r.number ?? r.phone ?? r.phoneNumber ?? r.value ?? r.digits);
        }
      }
    }

    const phones = record.phones;
    if (Array.isArray(phones)) {
      for (const entry of phones) {
        if (typeof entry === "string") pushPhone(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushPhone(out, r.number ?? r.phone ?? r.phoneNumber ?? r.value ?? r.digits);
        }
      }
    }
  }
  return out;
}

/**
 * Contact emails let us match social/Apple/Google sign-ups, which carry no
 * phone hash. Emails are compared transiently and never persisted.
 */
function extractEmails(contacts: Array<ContactInput | string>): string[] {
  const out: string[] = [];
  for (const c of contacts || []) {
    if (typeof c === "string") {
      pushEmail(out, c);
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const record = c as Record<string, unknown>;

    pushEmail(out, record.email);

    const emails = record.emails;
    if (Array.isArray(emails)) {
      for (const entry of emails) {
        if (typeof entry === "string") pushEmail(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushEmail(out, r.email ?? r.address ?? r.value);
        }
      }
    }
  }
  return Array.from(new Set(out));
}

/**
 * Canonical hashes used for counts/storage. Each phone contributes exactly one
 * hash, so the reported contact total is not inflated by format variants.
 */
export function hashContactsList(contacts: Array<ContactInput | string>): string[] {
  const hashes: string[] = [];
  for (const p of extractPhones(contacts)) {
    const trimmed = p.trim();
    // If caller already passed a 64-char hex hash, keep it.
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      hashes.push(trimmed.toLowerCase());
    } else {
      const h = hashPhoneNumber(p);
      if (h) hashes.push(h);
    }
  }
  return Array.from(new Set(hashes));
}

/**
 * Every hash a stored phone could use: local vs E.164 vs country-code variants.
 * Used only for lookups so contacts match regardless of how the device stored
 * the number or how the user originally registered.
 */
export function lookupContactHashes(contacts: Array<ContactInput | string>): string[] {
  const hashes = new Set<string>();
  for (const p of extractPhones(contacts)) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      hashes.add(trimmed.toLowerCase());
    } else {
      for (const h of hashPhoneCandidates(p)) hashes.add(h);
    }
  }
  return [...hashes];
}

async function blockedUserIds(userId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: candidateIds } },
        { blockerId: { in: candidateIds }, blockedId: userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
}

/**
 * Resolve the active accounts (dating profile or not) whose phone hash matches
 * any synced contact. Blocked pairs are excluded. Raw contacts are hashed in
 * memory and never persisted.
 */
export async function findContactUsers(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<{ users: ContactUser[]; totalContacts: number }> {
  const phoneHashes = hashContactsList(contacts);
  const emails = extractEmails(contacts);
  const totalContacts = new Set([...phoneHashes, ...emails]).size;
  const lookupHashes = lookupContactHashes(contacts);
  if (lookupHashes.length === 0 && emails.length === 0) {
    return { users: [], totalContacts };
  }

  const baseWhere = {
    id: { not: userId },
    accountStatus: "ACTIVE" as const,
    isDeleted: false,
  };

  const lookupDigits = Array.from(
    new Set(
      extractPhones(contacts)
        .flatMap((p) => {
          const trimmed = p.trim();
          if (/^[a-f0-9]{64}$/i.test(trimmed)) return [];
          return phoneDigitCandidates(trimmed);
        })
        .filter(Boolean),
    ),
  );

  const buildOr = (includeVariants: boolean): Prisma.UserWhereInput[] => {
    const clauses: Prisma.UserWhereInput[] = [];
    if (lookupHashes.length > 0) {
      clauses.push({ phoneNumberHash: { in: lookupHashes } }, { phoneHash: { in: lookupHashes } });
      if (includeVariants) {
        // Pre-hashed contacts cannot be expanded by the server; the variants table
        // stores every plausible form for each user so these still match.
        clauses.push({ phoneHashVariants: { some: { hash: { in: lookupHashes } } } });
      }
    }
    if (lookupDigits.length > 0) {
      // Fallback for accounts missing/corrupt hashes: compare stored phone digits.
      clauses.push({ phoneNumber: { in: lookupDigits } });
    }
    if (emails.length > 0) {
      clauses.push({ email: { in: emails, mode: "insensitive" } });
    }
    return clauses;
  };

  let users: ContactUser[];
  try {
    users = await prisma.user.findMany({
      where: { ...baseWhere, OR: buildOr(true) },
      select: contactUserSelect,
    });
  } catch (error) {
    // Variants table may be unavailable before migration; fall back to hash columns.
    console.warn("[contacts] variant lookup failed, retrying without variants", error);
    const fallbackOr = buildOr(false);
    if (fallbackOr.length === 0) return { users: [], totalContacts };
    users = await prisma.user.findMany({
      where: { ...baseWhere, OR: fallbackOr },
      select: contactUserSelect,
    });
  }

  const blocked = await blockedUserIds(
    userId,
    users.map((u) => u.id),
  );
  return { users: users.filter((u) => !blocked.has(u.id)), totalContacts };
}

/** Persist the derived matches and record the caller's sync consent. */
export async function persistContactMatches(
  userId: string,
  matchedUsers: Array<Pick<ContactUser, "id" | "phoneNumberHash" | "phoneHash">>,
  totalContacts: number,
): Promise<void> {
  const existing = await prisma.contactSyncConsent.findUnique({ where: { userId } });
  const now = new Date();
  const matchedIds = matchedUsers.map((u) => u.id);

  await prisma.$transaction(async (tx) => {
    await tx.contactSyncConsent.upsert({
      where: { userId },
      create: {
        userId,
        granted: true,
        grantedAt: now,
        lastSyncedAt: now,
        contactCount: totalContacts,
      },
      update: {
        granted: true,
        grantedAt: existing?.grantedAt ?? now,
        revokedAt: null,
        lastSyncedAt: now,
        contactCount: totalContacts,
      },
    });

    await tx.contactMatch.deleteMany({
      where: {
        userId,
        ...(matchedIds.length > 0 ? { matchedUserId: { notIn: matchedIds } } : {}),
      },
    });

    if (matchedUsers.length > 0) {
      await tx.contactMatch.createMany({
        data: matchedUsers.map((u) => ({
          userId,
          matchedUserId: u.id,
          phoneHash: u.phoneNumberHash ?? u.phoneHash ?? "",
        })),
        skipDuplicates: true,
      });
    }
  });
}

export function toContactMatch(user: ContactUser): ContactMatch {
  return {
    userId: user.id,
    name: user.fullName || user.username || null,
    phoneNumber: user.phoneNumber,
    profileImageUrl:
      user.profileImageUrl ??
      user.profile?.bio_profile_image_url ??
      user.profile?.profileUrl ??
      null,
    headline: user.datingProfile?.headline ?? null,
    hasDatingProfile: user.datingProfile !== null,
  };
}

export async function matchContacts(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<{
  matchedCount: number;
  matches: ContactMatch[];
  totalContacts: number;
  unmatchedCount: number;
  banner: string;
}> {
  const { users, totalContacts } = await findContactUsers(userId, contacts);
  if (totalContacts > 0) {
    await persistContactMatches(userId, users, totalContacts);
  }

  const matches = users.map(toContactMatch);
  const unmatchedCount = Math.max(totalContacts - matches.length, 0);

  const names = matches.map((m) => m.name).filter(Boolean);
  const firstName = names[0] || "someone";
  const banner =
    matches.length === 0
      ? "No contacts found on Diaspora Sync yet. Invite them to join."
      : matches.length === 1
        ? `1 person in your contact list (${firstName}) is already on Diaspora Sync! Tap to connect.`
        : `${matches.length} people in your contact list (including ${firstName}) are already on Diaspora Sync! Tap to connect.`;

  // Best-effort push notification for the syncing user.
  if (matches.length > 0) {
    try {
      const devices = await prisma.userDevice.findMany({
        where: { userId, enabled: true },
      });
      const expo = new Expo();
      const messages: ExpoPushMessage[] = [];
      for (const device of devices || []) {
        const token = device.expoPushToken;
        if (token && Expo.isExpoPushToken(token)) {
          messages.push({
            to: token,
            title: "Diaspora Sync",
            body: banner,
            data: { type: "CONTACT_MATCH" },
          });
        }
      }
      if (messages.length) {
        await expo.sendPushNotificationsAsync(messages);
      }
    } catch {
      // ignore push failures
    }
  }

  return {
    matchedCount: matches.length,
    matches,
    totalContacts,
    unmatchedCount,
    banner,
  };
}

export async function syncContacts(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<Awaited<ReturnType<typeof matchContacts>>> {
  return matchContacts(userId, contacts);
}

/** Persisted matches for the caller, excluding blocked pairs. */
export async function getContactMatches(userId: string): Promise<ContactMatch[]> {
  const consent = await prisma.contactSyncConsent.findUnique({ where: { userId } });
  if (!consent?.granted) return [];

  const rows = await prisma.contactMatch.findMany({
    where: {
      userId,
      matchedUser: {
        accountStatus: "ACTIVE",
        blockedUsers: { none: { blockedId: userId } },
        blockedBy: { none: { blockerId: userId } },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { matchedUser: { select: contactUserSelect } },
    take: 2000,
  });

  return rows
    .filter((row) => row.matchedUser !== null)
    .map((row) => toContactMatch(row.matchedUser));
}

export async function clearContactMatches(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.contactMatch.deleteMany({ where: { userId } });
    await tx.contactSyncConsent.upsert({
      where: { userId },
      create: { userId, granted: false, revokedAt: new Date() },
      update: { granted: false, revokedAt: new Date(), contactCount: 0 },
    });
  });
}

/** Shareable invite link so unmatched contacts can be invited to the app. */
export async function buildInviteLink(userId: string): Promise<{
  inviterName: string;
  shareUrl: string;
  title: string;
  imageUrl: string | null;
  token: string;
  deepLink: string;
  deferredDeepLink: string;
  storeUrl: string;
  playStoreUrl: string;
  appStoreUrl: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, username: true, profileImageUrl: true },
  });
  const inviterName = user?.fullName || user?.username || "Diaspora Sync member";
  const smart = await deepLinkService.createSmartLink({
    type: "app",
    id: userId,
    inviterId: userId,
  });
  const shareUrl = `${API_BASE_URL}/share/app?inviter=${encodeURIComponent(inviterName)}&token=${encodeURIComponent(smart.token)}`;

  return {
    inviterName,
    shareUrl,
    title: `${inviterName} wants to connect with you on Diaspora Sync`,
    imageUrl: user?.profileImageUrl ?? null,
    token: smart.token,
    deepLink: smart.deepLink,
    deferredDeepLink: smart.deferredDeepLink,
    storeUrl: smart.storeUrl,
    playStoreUrl: smart.playStoreUrl,
    appStoreUrl: smart.appStoreUrl,
  };
}

// Aliases
export const syncContactBook = syncContacts;
export const matchContactBook = matchContacts;
export const findContactsOnPlatform = matchContacts;
export const getMatchedContacts = getContactMatches;

export const findMatchingContacts = matchContacts;
export const findContacts = matchContacts;
export const matchContactPhones = matchContacts;
export const syncContactPhones = syncContacts;
