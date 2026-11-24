import { prisma } from "../config/index.js";
import { canDatingInteract, oppositeGenderPreference } from "../helpers/dating-gender.js";
import {
  buildInviteLink,
  contactUserSelect,
  findContactUsers,
  getContactSyncConsent,
  getContactSyncConsentWithCapabilities,
  persistContactMatches,
  refreshContactMatches,
  upsertContactConsentWithoutHashes,
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
  invite: Awaited<ReturnType<typeof buildInviteLink>> | null;
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
 * not) and persist every match. Raw contact values are hashed in memory and
 * never written to the database. Dating responses show only opposite-gender
 * contacts; the general contact book remains unfiltered.
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
    const existingConsent = await getContactSyncConsent(userId);
    existingGranted = existingConsent?.granted === true;
  } catch {
    // consent table may be unavailable before migration; require explicit consent this call
  }

  const granted = consent === true || existingGranted;
  if (!granted) {
    throw new Error("CONTACT_CONSENT_REQUIRED");
  }

  const { users, totalContacts, lookupHashes } = await findContactUsers(userId, contacts);

  if (totalContacts > 0) {
    await persistContactMatches(userId, users, totalContacts, lookupHashes);
  }

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { gender: true },
  });
  const genderRows =
    users.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: users.map((user) => user.id) } },
          select: { id: true, gender: true },
        })
      : [];
  const compatibleIds = new Set(
    genderRows.filter((row) => canDatingInteract(viewer?.gender, row.gender)).map((row) => row.id),
  );
  const compatibleUsers = users.filter((user) => compatibleIds.has(user.id));
  const publicMatches = compatibleUsers.map(toPublicMatch);
  const unmatchedCount = Math.max(totalContacts - publicMatches.length, 0);
  const firstName = publicMatches[0]?.fullName || "someone";
  const banner =
    publicMatches.length === 0
      ? "No contacts found on Diaspora Sync yet. Invite them to join."
      : publicMatches.length === 1
        ? `1 person in your contact list (${firstName}) is on Diaspora Sync. Tap to connect.`
        : `${publicMatches.length} people in your contact list (including ${firstName}) are on Diaspora Sync. Tap to connect.`;

  let invite: Awaited<ReturnType<typeof buildInviteLink>> | null = null;
  try {
    invite = await buildInviteLink(userId);
  } catch (error) {
    console.warn("[dating.contacts] failed to build invite link", { userId, error });
  }

  return {
    matchedCount: publicMatches.length,
    totalContacts,
    unmatchedCount,
    matches: publicMatches,
    banner,
    invite,
  };
}

/** Persisted contact matches, including contacts without a dating profile. */
export async function getDatingContactMatches(
  userId: string,
  options: { allGenders?: boolean } = {},
): Promise<DatingContactMatch[]> {
  try {
    await refreshContactMatches(userId);
  } catch (error) {
    console.warn("[dating.contacts] failed to refresh contact matches", { userId, error });
  }

  const includeAllGenders = options.allGenders === true;

  try {
    let allowedGenders: ReturnType<typeof oppositeGenderPreference> | undefined;
    if (!includeAllGenders) {
      const viewer = await prisma.user.findUnique({
        where: { id: userId },
        select: { gender: true },
      });
      allowedGenders = oppositeGenderPreference(viewer?.gender);
      if (allowedGenders.length === 0) return [];
    }

    const rows = await prisma.contactMatch.findMany({
      where: {
        userId,
        matchedUser: {
          ...(allowedGenders ? { gender: { in: allowedGenders } } : {}),
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
    await refreshContactMatches(userId);
  } catch (error) {
    console.warn("[dating.contacts] failed to refresh contact ids", { userId, error });
  }

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
      getContactSyncConsent(userId),
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
  const { consent, supportsLookupHashes } = await getContactSyncConsentWithCapabilities(userId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.contactMatch.deleteMany({ where: { userId } });
    if (supportsLookupHashes) {
      await tx.contactSyncConsent.upsert({
        where: { userId },
        create: { userId, granted: false, revokedAt: now, lookupHashes: [] },
        update: {
          granted: false,
          revokedAt: now,
          contactCount: 0,
          lookupHashes: [],
        },
      });
    } else {
      await upsertContactConsentWithoutHashes(tx, userId, {
        granted: false,
        grantedAt: consent?.grantedAt ?? null,
        revokedAt: now,
        lastSyncedAt: consent?.lastSyncedAt ?? null,
        contactCount: 0,
      });
    }
  });
}
