import { prisma } from "../config/index.js";
import { hashContactsList, type ContactInput } from "../modules/contacts/contacts.service.js";

export interface DatingContactMatch {
  userId: string;
  fullName: string;
  headline: string | null;
  photos: string[];
  profileImageUrl: string | null;
}

export interface DatingContactSyncResult {
  matchedCount: number;
  totalContacts: number;
  matches: DatingContactMatch[];
  banner: string;
}

const contactUserSelect = {
  id: true,
  fullName: true,
  phoneNumberHash: true,
  phoneHash: true,
  profile: { select: { bio_profile_image_url: true, profileUrl: true } },
  datingProfile: { select: { headline: true, photos: true } },
} as const;

function toPublicMatch(user: {
  id: string;
  fullName: string;
  profile: { bio_profile_image_url: string | null; profileUrl: string | null } | null;
  datingProfile: { headline: string | null; photos: string[] } | null;
}): DatingContactMatch {
  return {
    userId: user.id,
    fullName: user.fullName,
    headline: user.datingProfile?.headline ?? null,
    photos: user.datingProfile?.photos ?? [],
    profileImageUrl: user.profile?.bio_profile_image_url ?? user.profile?.profileUrl ?? null,
  };
}

/**
 * Match hashed phone numbers against active dating users, persisting only the
 * resulting public matches. Raw contact values are hashed in memory and never
 * written to the database.
 *
 * The caller must have an active contact-sync consent on record (or pass
 * `consent: true` on the first sync).
 */
export async function syncDatingContacts(
  userId: string,
  contacts: Array<ContactInput | string>,
  consent?: boolean,
): Promise<DatingContactSyncResult> {
  const existingConsent = await prisma.contactSyncConsent.findUnique({
    where: { userId },
  });

  const granted = consent === true || existingConsent?.granted === true;
  if (!granted) {
    throw new Error("CONTACT_CONSENT_REQUIRED");
  }

  const hashes = hashContactsList(contacts);

  const users = hashes.length
    ? await prisma.user.findMany({
        where: {
          id: { not: userId },
          accountStatus: "ACTIVE",
          OR: [{ phoneNumberHash: { in: hashes } }, { phoneHash: { in: hashes } }],
          datingProfile: { isNot: null },
        },
        select: contactUserSelect,
      })
    : [];

  const blocked = users.length
    ? await prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: userId, blockedId: { in: users.map((u) => u.id) } },
            { blockerId: { in: users.map((u) => u.id) }, blockedId: userId },
          ],
        },
        select: { blockerId: true, blockedId: true },
      })
    : [];

  const blockedIds = new Set(
    blocked.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
  );

  const matches = users.filter((u) => !blockedIds.has(u.id));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.contactSyncConsent.upsert({
      where: { userId },
      create: {
        userId,
        granted: true,
        grantedAt: now,
        lastSyncedAt: now,
        contactCount: hashes.length,
      },
      update: {
        granted: true,
        grantedAt: existingConsent?.grantedAt ?? now,
        revokedAt: null,
        lastSyncedAt: now,
        contactCount: hashes.length,
      },
    });

    await tx.contactMatch.deleteMany({
      where: {
        userId,
        ...(matches.length > 0 ? { matchedUserId: { notIn: matches.map((m) => m.id) } } : {}),
      },
    });

    if (matches.length > 0) {
      await tx.contactMatch.createMany({
        data: matches.map((m) => ({
          userId,
          matchedUserId: m.id,
          phoneHash: m.phoneNumberHash ?? m.phoneHash ?? "",
        })),
        skipDuplicates: true,
      });
    }
  });

  const publicMatches = matches.map(toPublicMatch);
  const firstName = publicMatches[0]?.fullName || "someone";
  const banner =
    publicMatches.length === 0
      ? "No contacts found on Diaspora Sync yet."
      : publicMatches.length === 1
        ? `1 person in your contact list (${firstName}) is on Diaspora Sync. Tap to connect.`
        : `${publicMatches.length} people in your contact list (including ${firstName}) are on Diaspora Sync. Tap to connect.`;

  return {
    matchedCount: publicMatches.length,
    totalContacts: hashes.length,
    matches: publicMatches,
    banner,
  };
}

/** Persisted contact matches, restricted to users with a dating profile. */
export async function getDatingContactMatches(userId: string): Promise<DatingContactMatch[]> {
  const rows = await prisma.contactMatch.findMany({
    where: {
      userId,
      matchedUser: { datingProfile: { isNot: null }, accountStatus: "ACTIVE" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      matchedUser: {
        select: {
          id: true,
          fullName: true,
          profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          datingProfile: { select: { headline: true, photos: true } },
        },
      },
    },
    take: 1000,
  });

  return rows.map((row) => toPublicMatch(row.matchedUser));
}

/** User ids in the caller's synced contacts that are on the dating platform. */
export async function getDatingContactUserIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.contactMatch.findMany({
    where: { userId },
    select: { matchedUserId: true },
    take: 5000,
  });
  return new Set(rows.map((row) => row.matchedUserId));
}

export async function getContactSyncStatus(userId: string): Promise<{
  granted: boolean;
  grantedAt: Date | null;
  lastSyncedAt: Date | null;
  contactCount: number;
  matchedCount: number;
}> {
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
