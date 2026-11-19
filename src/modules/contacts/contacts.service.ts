import crypto from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client.js";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "../../config/index.js";
import {
  hashPhoneLookupCandidates,
  hashPhoneNumber,
  normalizePhoneNumber,
  phoneDigitCandidates,
  phoneHashCandidateStrings,
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
  profile: { select: { bio_profile_image_url: true, profileUrl: true, phoneNumber: true } },
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
  const hashes = hashPhoneLookupCandidates(phone);
  if (hashes.length === 0) return;

  try {
    await prisma.phoneHashVariant.deleteMany({ where: { userId } });
    await prisma.phoneHashVariant.createMany({
      data: hashes.map((hash) => ({ id: crypto.randomUUID(), userId, hash })),
      skipDuplicates: true,
    });
  } catch (error) {
    // Best-effort: table may be missing before migration; hash columns still work.
    console.warn("[contacts] failed to sync phone hash variants", { userId, error });
  }
}

function pushPhone(out: string[], value: unknown): void {
  if (value === null || value === undefined) return;
  const str = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const trimmed = str.trim();
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

    for (const key of [
      "phone",
      "phoneNumber",
      "number",
      "digits",
      "hash",
      "phoneHash",
      "mobile",
      "tel",
      "telephone",
      "e164",
      "formattedNumber",
      "formatted_number",
      "phone_number",
    ]) {
      pushPhone(out, record[key]);
    }

    const phoneNumbers = record.phoneNumbers;
    if (Array.isArray(phoneNumbers)) {
      for (const entry of phoneNumbers) {
        if (typeof entry === "string" || typeof entry === "number") pushPhone(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushPhone(
            out,
            r.number ?? r.phone ?? r.phoneNumber ?? r.value ?? r.digits ?? r.e164 ?? r.mobile,
          );
        }
      }
    }

    const phones = record.phones;
    if (Array.isArray(phones)) {
      for (const entry of phones) {
        if (typeof entry === "string" || typeof entry === "number") pushPhone(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushPhone(
            out,
            r.number ?? r.phone ?? r.phoneNumber ?? r.value ?? r.digits ?? r.e164 ?? r.mobile,
          );
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

    for (const key of ["email", "emailAddress", "email_address", "mail"]) {
      pushEmail(out, record[key]);
    }

    const emails = record.emails;
    if (Array.isArray(emails)) {
      for (const entry of emails) {
        if (typeof entry === "string") pushEmail(out, entry);
        else if (entry && typeof entry === "object") {
          const r = entry as Record<string, unknown>;
          pushEmail(out, r.email ?? r.address ?? r.value ?? r.mail);
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
      for (const h of hashPhoneLookupCandidates(p)) hashes.add(h);
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

  const excludedStatuses: Prisma.EnumAccountStatusFilter["notIn"] = [
    "SUSPENDED",
    "TERMINATED",
    "DEACTIVATED",
  ];
  const baseWhere: Prisma.UserWhereInput = {
    id: { not: userId },
    isDeleted: false,
    accountStatus: { notIn: excludedStatuses },
  };

  const rawPhones = extractPhones(contacts)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^[a-f0-9]{64}$/i.test(p));

  const lookupDigits = Array.from(
    new Set(rawPhones.flatMap((p) => phoneDigitCandidates(p)).filter(Boolean)),
  );

  const phoneStringCandidates = Array.from(
    new Set([
      ...rawPhones,
      ...rawPhones.flatMap((p) => phoneHashCandidateStrings(p)),
      ...lookupDigits.flatMap((d) => {
        const forms = [d, `+${d}`];
        if (d.startsWith("233") && d.length > 3) forms.push(`0${d.slice(3)}`);
        if (d.length === 10 && d.startsWith("0")) forms.push(`+233${d.slice(1)}`);
        return forms;
      }),
    ]),
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
    if (phoneStringCandidates.length > 0) {
      // Fallback for accounts missing/corrupt hashes: compare stored phone strings.
      clauses.push({ phoneNumber: { in: phoneStringCandidates } });
      clauses.push({ profile: { is: { phoneNumber: { in: phoneStringCandidates } } } });
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

  // Last-resort fallback for environments where hash columns/variants are not yet
  // populated (migration/backfill pending): compare computed hashes against stored
  // phone numbers in memory.
  if (lookupHashes.length > 0) {
    const foundIds = new Set(users.map((u) => u.id));
    const lookupSet = new Set(lookupHashes);
    try {
      const candidates: ContactUser[] = await prisma.user.findMany({
        where: {
          ...baseWhere,
          id: foundIds.size > 0 ? { notIn: [...foundIds, userId] } : { not: userId },
          OR: [{ phoneNumber: { not: null } }, { profile: { is: { phoneNumber: { not: null } } } }],
        },
        select: contactUserSelect,
      });
      for (const candidate of candidates) {
        if (foundIds.has(candidate.id)) continue;
        const profilePhone =
          candidate.profile && "phoneNumber" in candidate.profile
            ? ((candidate.profile as { phoneNumber?: string | null }).phoneNumber ?? null)
            : null;
        const candidateHashes = new Set([
          ...hashPhoneLookupCandidates(candidate.phoneNumber),
          ...hashPhoneLookupCandidates(profilePhone),
        ]);
        for (const h of candidateHashes) {
          if (lookupSet.has(h)) {
            users.push(candidate);
            foundIds.add(candidate.id);
            break;
          }
        }
      }
    } catch (error) {
      console.warn("[contacts] in-memory fallback scan failed", error);
    }
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

  try {
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
        const ts = new Date();
        await tx.contactMatch.createMany({
          data: matchedUsers.map((u) => ({
            id: crypto.randomUUID(),
            userId,
            matchedUserId: u.id,
            phoneHash: u.phoneNumberHash ?? u.phoneHash ?? "",
            createdAt: ts,
            updatedAt: ts,
          })),
          skipDuplicates: true,
        });
      }
    });
  } catch (error) {
    // Best-effort: tables may be unavailable before migration; sync still returns matches.
    console.warn("[contacts] failed to persist contact matches", { userId, error });
  }
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

export function buildContactBanner(count: number, firstName?: string | null): string {
  if (count === 0) return "No contacts found on Diaspora Sync yet. Invite them to join.";
  const name = firstName || "someone";
  return count === 1
    ? `1 person in your contact list (${name}) is already on Diaspora Sync! Tap to connect.`
    : `${count} people in your contact list (including ${name}) are already on Diaspora Sync! Tap to connect.`;
}

export async function matchContacts(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<{
  matchedCount: number;
  contactsOnAppCount: number;
  appUserCount: number;
  matchedContactsCount: number;
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
  const banner = buildContactBanner(matches.length, names[0]);

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
    contactsOnAppCount: matches.length,
    appUserCount: matches.length,
    matchedContactsCount: matches.length,
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
  let consentGranted = false;
  try {
    const consent = await prisma.contactSyncConsent.findUnique({ where: { userId } });
    consentGranted = !!consent?.granted;
  } catch {
    // consent table may be missing; fall through to try reading matches
  }

  try {
    const rows = await prisma.contactMatch.findMany({
      where: {
        userId,
        matchedUser: {
          isDeleted: false,
          accountStatus: {
            notIn: ["SUSPENDED" as const, "TERMINATED" as const, "DEACTIVATED" as const] as (
              "SUSPENDED" | "TERMINATED" | "DEACTIVATED"
            )[],
          },
          blockedUsers: { none: { blockedId: userId } },
          blockedBy: { none: { blockerId: userId } },
        },
      },
      orderBy: { createdAt: "desc" },
      select: { matchedUser: { select: contactUserSelect } },
      take: 2000,
    });

    const matches = rows
      .filter((row) => row.matchedUser !== null)
      .map((row) => toContactMatch(row.matchedUser));
    if (matches.length > 0 || consentGranted) return matches;
  } catch (error) {
    console.warn("[contacts] failed to read persisted contact matches", { userId, error });
  }

  return [];
}

/** Persisted matches plus explicit "how many contacts use the app" counts. */
export async function getContactMatchSummary(userId: string): Promise<{
  matches: ContactMatch[];
  matchedCount: number;
  contactsOnAppCount: number;
  appUserCount: number;
  matchedContactsCount: number;
  totalContacts: number;
  unmatchedCount: number;
  banner: string;
}> {
  const [matches, totalContacts] = await Promise.all([
    getContactMatches(userId),
    (async () => {
      try {
        const consent = await prisma.contactSyncConsent.findUnique({ where: { userId } });
        return consent?.contactCount ?? 0;
      } catch {
        return 0;
      }
    })(),
  ]);

  const names = matches.map((m) => m.name).filter(Boolean);
  return {
    matches,
    matchedCount: matches.length,
    contactsOnAppCount: matches.length,
    appUserCount: matches.length,
    matchedContactsCount: matches.length,
    totalContacts,
    unmatchedCount: Math.max(totalContacts - matches.length, 0),
    banner: buildContactBanner(matches.length, names[0]),
  };
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
