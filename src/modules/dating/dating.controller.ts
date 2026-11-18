import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { resolveDatingProfileStatus } from "../../helpers/dating-profile-status.js";
import type { Ethnicity } from "../../../generated/prisma/enums.js";

type AccountProfileData = {
  fullName?: string;
  gender?: string;
  dateOfBirth?: Date;
  ethnicity?: Ethnicity;
};

function buildAccountProfileData(body: Record<string, unknown>): AccountProfileData {
  const data: AccountProfileData = {};
  if (typeof body.fullName === "string") data.fullName = body.fullName;
  if (typeof body.gender === "string") data.gender = body.gender;
  if (body.dateOfBirth !== undefined) data.dateOfBirth = new Date(body.dateOfBirth as string);
  if (typeof body.ethnicity === "string") data.ethnicity = body.ethnicity as Ethnicity;
  return data;
}

function buildDatingProfileData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of [
    "headline",
    "about",
    "photos",
    "heightCm",
    "interests",
    "lookingFor",
    "location",
    "degree",
    "university",
    "profession",
    "industry",
    "workLocation",
    "languages",
    "religion",
    "hometown",
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

const datingProfileInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      username: true,
      dateOfBirth: true,
      gender: true,
      ethnicity: true,
      profileImageUrl: true,
      profile: { select: { bio_profile_image_url: true, profileUrl: true } },
    },
  },
} as const;

/**
 * Get the authenticated user's dating profile (+ discovery preferences).
 */
export const getMyDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const profile = await prisma.datingProfile.findUnique({
      where: { userId },
      include: {
        ...datingProfileInclude,
        discoveryPreference: true,
      },
    });

    if (!profile) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    return ok(res, profile);
  } catch (error) {
    console.error("Get dating profile error:", error);
    return fail(res, 500, "Failed to fetch dating profile");
  }
};

/**
 * Initialize (or retrieve existing) dating profile for the current user.
 * Accepts the full profile-creation payload so every field from the creation
 * form is captured in a single call.
 */
export const initDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.datingProfile.findUnique({ where: { userId } });
    if (existing) {
      return ok(res, existing, "Dating profile already exists.");
    }

    const profile = await prisma.datingProfile.create({
      data: {
        userId,
        photos: [],
        interests: [],
        ...buildDatingProfileData(body),
      },
    });

    // Persist account-level fields submitted with the creation form.
    const accountData = buildAccountProfileData(body);
    if (Object.keys(accountData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: accountData });
    }

    return created(res, profile, "Dating profile created successfully.");
  } catch (error) {
    console.error("Init dating profile error:", error);
    return fail(res, 500, "Failed to initialize dating profile");
  }
};

/**
 * Update the current user's dating profile fields.
 * Also persists account-level fields (fullName, gender, dateOfBirth, ethnicity)
 * when they accompany the update, so every value from the profile forms is saved.
 */
export const updateDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.datingProfile.findUnique({ where: { userId } });
    if (!existing) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    const profile = await prisma.datingProfile.update({
      where: { userId },
      data: buildDatingProfileData(body),
    });

    const accountData = buildAccountProfileData(body);
    if (Object.keys(accountData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: accountData });
    }

    return ok(res, profile, "Dating profile updated successfully.");
  } catch (error) {
    console.error("Update dating profile error:", error);
    return fail(res, 500, "Failed to update dating profile");
  }
};

/**
 * Get the authenticated user's dating profile status.
 * Returning users who already possess a (complete) profile can use this to
 * bypass the initial profile creation/skip screen entirely.
 */
export const getDatingProfileStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const profile = await prisma.datingProfile.findUnique({
      where: { userId },
      include: { discoveryPreference: true },
    });

    const hasProfile = Boolean(profile);
    const profileStatus = resolveDatingProfileStatus(profile);

    return ok(res, {
      hasProfile,
      profileStatus,
      profile: profile ?? null,
    });
  } catch (error) {
    console.error("Get dating profile status error:", error);
    return fail(res, 500, "Failed to fetch dating profile status");
  }
};

/**
 * Get a public dating profile by user id (for viewing other members).
 */
export const getDatingProfileById = async (req: Request, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const targetUserId = req.params.userId as string;

    if (viewerId === targetUserId) {
      return fail(res, 400, "Use the profile endpoint to view your own profile.");
    }

    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: viewerId },
        ],
      },
    });

    if (block) {
      return fail(res, 403, "Cannot view this profile.");
    }

    const profile = await prisma.datingProfile.findUnique({
      where: { userId: targetUserId },
      include: datingProfileInclude,
    });

    if (!profile) {
      return fail(res, 404, "Profile not found or not created yet.");
    }

    return ok(res, profile);
  } catch (error) {
    console.error("Get dating profile by id error:", error);
    return fail(res, 500, "Failed to fetch dating profile");
  }
};

/**
 * Deactivate (soft-delete) the current user's dating profile.
 * Removes the profile and discovery preferences from discovery but keeps
 * the user account intact. The user can re-initialize later.
 */
export const deactivateDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const existing = await prisma.datingProfile.findUnique({ where: { userId } });
    if (!existing) {
      return fail(res, 404, "Dating profile not found.");
    }

    // Deleting the dating profile cascades to discovery preferences.
    await prisma.datingProfile.delete({ where: { userId } });

    return ok(res, null, "Dating profile deactivated successfully.");
  } catch (error) {
    console.error("Deactivate dating profile error:", error);
    return fail(res, 500, "Failed to deactivate dating profile");
  }
};

/**
 * Get or create the current user's discovery preferences.
 */
export const getDiscoveryPreference = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const preference = await prisma.discoveryPreference.findUnique({
      where: { userId },
    });

    if (!preference) {
      return fail(res, 404, "Discovery preferences not set.");
    }

    return ok(res, preference);
  } catch (error) {
    console.error("Get discovery preference error:", error);
    return fail(res, 500, "Failed to fetch discovery preferences");
  }
};

/**
 * Update (upsert) the current user's discovery preferences.
 */
export const updateDiscoveryPreference = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body;

    const profile = await prisma.datingProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    const hasCoords =
      typeof body.locationLat === "number" && typeof body.locationLng === "number";
    const clearedCoords = body.locationLat === null || body.locationLng === null;

    const preference = await prisma.discoveryPreference.upsert({
      where: { userId },
      create: {
        userId,
        datingProfileId: profile.id,
        lookingFor: body.lookingFor,
        genderPreference: body.genderPreference ?? [],
        minAge: body.minAge ?? 18,
        maxAge: body.maxAge ?? 60,
        maxDistanceKm: body.maxDistanceKm ?? 50,
        globalDiscovery: body.globalDiscovery ?? true,
        locationLat: body.locationLat ?? null,
        locationLng: body.locationLng ?? null,
        locationName: body.locationName ?? null,
        locationUpdatedAt: hasCoords ? new Date() : null,
        showProfile: body.showProfile ?? true,
        showOnlineStatus: body.showOnlineStatus ?? true,
      },
      update: {
        lookingFor: body.lookingFor ?? undefined,
        genderPreference: body.genderPreference ?? undefined,
        minAge: body.minAge ?? undefined,
        maxAge: body.maxAge ?? undefined,
        maxDistanceKm: body.maxDistanceKm ?? undefined,
        globalDiscovery: body.globalDiscovery ?? undefined,
        locationLat: body.locationLat !== undefined ? body.locationLat : undefined,
        locationLng: body.locationLng !== undefined ? body.locationLng : undefined,
        locationName: body.locationName !== undefined ? body.locationName : undefined,
        locationUpdatedAt: hasCoords ? new Date() : clearedCoords ? null : undefined,
        showProfile: body.showProfile ?? undefined,
        showOnlineStatus: body.showOnlineStatus ?? undefined,
      },
    });

    return ok(res, preference, "Discovery preferences updated successfully.");
  } catch (error) {
    console.error("Update discovery preference error:", error);
    return fail(res, 500, "Failed to update discovery preferences");
  }
};

/**
 * Refresh the caller's dating location without touching other preferences.
 * Proximity alerts only consider locations refreshed within the last 12 hours.
 */
export const updateDatingLocation = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body as {
      locationLat?: number;
      locationLng?: number;
      latitude?: number;
      longitude?: number;
      locationName?: string | null;
    };

    const locationLat = body.locationLat ?? body.latitude;
    const locationLng = body.locationLng ?? body.longitude;

    if (typeof locationLat !== "number" || typeof locationLng !== "number") {
      return fail(res, 400, "A valid latitude and longitude are required");
    }

    const profile = await prisma.datingProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    const now = new Date();
    const preference = await prisma.discoveryPreference.upsert({
      where: { userId },
      create: {
        userId,
        datingProfileId: profile.id,
        locationLat,
        locationLng,
        locationName: body.locationName ?? null,
        locationUpdatedAt: now,
      },
      update: {
        locationLat,
        locationLng,
        ...(body.locationName !== undefined ? { locationName: body.locationName } : {}),
        locationUpdatedAt: now,
      },
    });

    return ok(res, preference, "Dating location updated");
  } catch (error) {
    console.error("Update dating location error:", error);
    return fail(res, 500, "Failed to update dating location");
  }
};

/**
 * Find a public dating profile by the target user's name.
 */
export const getDatingProfileByName = async (req: Request, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const raw =
      req.query.name ?? req.query.username ?? req.query.q ?? req.query.search;
    const name =
      typeof raw === "string"
        ? raw.trim()
        : Array.isArray(raw) && raw.length > 0
          ? String(raw[0]).trim()
          : "";

    if (!name) {
      return fail(res, 400, "Name is required");
    }

    const user: any =
      typeof prisma.user.findFirst === "function"
        ? await prisma.user.findFirst({
            where: { fullName: { contains: name } },
            select: {
              id: true,
              fullName: true,
              username: true,
              profileImageUrl: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          })
        : null;

    if (!user) {
      return fail(res, 404, "User not found");
    }

    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: user.id },
          { blockerId: user.id, blockedId: viewerId },
        ],
      },
    });

    if (block) {
      return fail(res, 403, "Cannot view this profile.");
    }

    const profile = await prisma.datingProfile.findUnique({
      where: { userId: user.id },
      include: datingProfileInclude,
    });

    if (!profile) {
      return fail(res, 404, "Profile not found or not created yet.");
    }

    const base = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
    const ogUrl = `${base}/dating/profile/search?username=${encodeURIComponent(user.username || name)}`;
    const ogImage =
      profile.photos?.[0] || user.profile?.bio_profile_image_url || user.profileImageUrl || null;
    const ogDescription = [profile.headline, profile.about].filter(Boolean).join(" ").trim();

    return ok(res, {
      ...profile,
      ogTitle: `${user.fullName}'s Dating Profile`,
      ogDescription,
      ogImage,
      ogUrl,
    });
  } catch (error) {
    console.error("Get dating profile by username error:", error);
    return fail(res, 500, "Failed to fetch dating profile");
  }
};

/**
 * Generate a shareable profile link for the authenticated user.
 */
export const getDatingProfileShare = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const profile = await prisma.datingProfile.findUnique({
      where: { userId },
      include: datingProfileInclude,
    });

    if (!profile) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    const user = profile.user;
    const primaryImage =
      profile.photos?.[0] || user.profile?.bio_profile_image_url || user.profileImageUrl || null;

    const base = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
    const shareUrl = `${base}/dating/profile/share`;

    return ok(res, {
      shareUrl,
      url: shareUrl,
      primaryImage,
      note: "Shareable profile link generated",
    });
  } catch (error) {
    console.error("Get dating profile share error:", error);
    return fail(res, 500, "Failed to generate share link");
  }
};

export const getDatingProfileByUsername = getDatingProfileByName;

/**
 * Return lightweight name-match suggestions for typeahead/discovery.
 */
export const getDatingProfileSuggestions = async (req: Request, res: Response) => {
  try {
    const raw =
      req.query.name ?? req.query.username ?? req.query.q ?? req.query.search;
    const name =
      typeof raw === "string"
        ? raw.trim()
        : Array.isArray(raw) && raw.length > 0
          ? String(raw[0]).trim()
          : "";

    if (!name) {
      return fail(res, 400, "Name is required");
    }

    const users =
      typeof prisma.user.findMany === "function"
        ? await prisma.user.findMany({
            where: { fullName: { contains: name } },
            select: {
              id: true,
              fullName: true,
              username: true,
              profileImageUrl: true,
            },
            take: 10,
            orderBy: { fullName: "asc" },
          })
        : [];

    return ok(res, users);
  } catch (error) {
    console.error("Get dating profile suggestions error:", error);
    return fail(res, 500, "Failed to fetch suggestions");
  }
};
