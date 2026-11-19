import { prisma } from "../config/index.js";
import {
  buildInviteLink,
  contactUserSelect,
  findContactUsers,
  persistContactMatches,
  type ContactInput,
  type ContactUser,
} from "../modules/contacts/contacts.service.js";

export interface DatingContactMatch {
  userId: string;
  fullName: string;
  headline: string | null;
  photos: string[];
  profileImageUrl: string | null;
  hasDatingProfile: boolean;
}

export interface DatingContactSyncResult {
  matchedCount: number;
  totalContacts: number;
  unmatchedCount: number;
  matches: DatingContactMatch[];
  banner: string;
  invite: Awaited<ReturnType<typeof buildInviteLink>>;
}

function toPublicMatch(user: ContactUser): DatingContactMatch {
  return {
    userId: user.id,
    fullName: user.fullName,
    headline: user.datingProfile?.headline ?? null,
    photos: user.datingProfile?.photos ?? [],
    profileImageUrl:
      user.profile?.bio_profile_image_url ??
      user.profileImageUrl ??
      user.profile?.profileUrl ??
      null,
    hasDatingProfile: user.datingProfile !== null,
  };
}

/**
 * Match hashed phone numbers against active platform accounts (dating profile or
 * not) and persist the public matches. Raw contact values are hashed in memory
 * and never written to the database.
 *
 * The caller must have an active contact-sync consent on record (or pass
 * `consent: true` on the first sync).
 */
export async function syncDatingContacts(
  userId: string,
  contacts: Array<ContactInput | string>,
  consent?: boolean,
): Promise<DatingContactSyncResult> {
  let existingGranted = false;
  try {
    const existingConsent = await prisma.contactSyncConsent.findUnique({
      where: { userId },
    });
    existingGranted = existingConsent?.granted === true;
  } catch {
    // consent table may be unavailable before migration; require explicit consent this call
  }

  const granted = consent === true || existingGranted;
  if (!granted) {
    throw new Error("CONTACT_CONSENT_REQUIRED");
  }

  const { users, totalContacts } = await findContactUsers(userId, contacts);
  if (totalContacts > 0) {
    await persistContactMatches(userId, users, totalContacts);
  }

  const publicMatches = users.map(toPublicMatch);
  const unmatchedCount = Math.max(totalContacts - publicMatches.length, 0);
  const firstName = publicMatches[0]?.fullName || "someone";
  const banner =
    publicMatches.length === 0
      ? "No contacts found on Diaspora Sync yet. Invite them to join."
      : publicMatches.length === 1
        ? `1 person in your contact list (${firstName}) is on Diaspora Sync. Tap to connect.`
        : `${publicMatches.length} people in your contact list (including ${firstName}) are on Diaspora Sync. Tap to connect.`;

  return {
    matchedCount: publicMatches.length,
    totalContacts,
    unmatchedCount,
    matches: publicMatches,
    banner,
    invite: await buildInviteLink(userId),
  };
}

/** Persisted contact matches, including contacts without a dating profile. */
export async function getDatingContactMatches(userId: string): Promise<DatingContactMatch[]> {
  try {
    const rows = await prisma.contactMatch.findMany({
      where: {
        userId,
        matchedUser: {
          isDeleted: false,
          accountStatus: { notIn: ["SUSPENDED", "TERMINATED", "DEACTIVATED"] as any },
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
      .map((row) => toPublicMatch(row.matchedUser));
  } catch (error) {
    console.warn("[dating.contacts] failed to read contact matches", { userId, error });
    return [];
  }
}

/** User ids in the caller's synced contacts that are on the platform. */
export async function getDatingContactUserIds(userId: string): Promise<Set<string>> {
  try {
    const rows = await prisma.contactMatch.findMany({
      where: { userId },
      select: { matchedUserId: true },
      take: 5000,
    });
    return new Set(rows.map((row) => row.matchedUserId));
  } catch {
    return new Set();
  }
}

export async function getContactSyncStatus(userId: string): Promise<{
  granted: boolean;
  grantedAt: Date | null;
  lastSyncedAt: Date | null;
  contactCount: number;
  matchedCount: number;
}> {
  try {
    const [consent, matchedCount] = await Promise.all([
      prisma.contactSyncConsent.findUnique({ where: { userId } }),
      prisma.contactMatch.count({ where: { userId } }),
    ]);

    return {
      granted: consent?.granted ?? false,
      grantedAt: consent?.grantedAt ?? null,
      lastSyncedAt: consent?.lastSyncedAt ?? null,
      contactCount: consent?.contactCount ?? 0,
      matchedCount,
    };
  } catch {
    return {
      granted: false,
      grantedAt: null,
      lastSyncedAt: null,
      contactCount: 0,
      matchedCount: 0,
    };
  }
}

/** Revoke contact access and delete every derived match. */
export async function revokeDatingContactConsent(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.contactMatch.deleteMany({ where: { userId } });
    await tx.contactSyncConsent.upsert({
      where: { userId },
      create: { userId, granted: false, revokedAt: new Date() },
      update: { granted: false, revokedAt: new Date(), contactCount: 0 },
    });
  });
}
