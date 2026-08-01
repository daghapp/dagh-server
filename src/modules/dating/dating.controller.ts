import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";

const datingProfileInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      dateOfBirth: true,
      gender: true,
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
 */
export const initDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const existing = await prisma.datingProfile.findUnique({ where: { userId } });
    if (existing) {
      return ok(res, existing, "Dating profile already exists.");
    }

    const profile = await prisma.datingProfile.create({
      data: {
        userId,
        photos: [],
        interests: [],
      },
    });

    return created(res, profile, "Dating profile created successfully.");
  } catch (error) {
    console.error("Init dating profile error:", error);
    return fail(res, 500, "Failed to initialize dating profile");
  }
};

/**
 * Update the current user's dating profile fields.
 */
export const updateDatingProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { headline, about, photos, heightCm, interests, lookingFor } = req.body;

    const existing = await prisma.datingProfile.findUnique({ where: { userId } });
    if (!existing) {
      return fail(res, 404, "Dating profile not found. Initialize it first.");
    }

    const profile = await prisma.datingProfile.update({
      where: { userId },
      data: {
        headline: headline ?? undefined,
        about: about ?? undefined,
        photos: photos ?? undefined,
        heightCm: heightCm ?? undefined,
        interests: interests ?? undefined,
        lookingFor: lookingFor ?? undefined,
      },
    });

    return ok(res, profile, "Dating profile updated successfully.");
  } catch (error) {
    console.error("Update dating profile error:", error);
    return fail(res, 500, "Failed to update dating profile");
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
        locationLat: body.locationLat ?? null,
        locationLng: body.locationLng ?? null,
        locationName: body.locationName ?? null,
        showProfile: body.showProfile ?? true,
        showOnlineStatus: body.showOnlineStatus ?? true,
      },
      update: {
        lookingFor: body.lookingFor ?? undefined,
        genderPreference: body.genderPreference ?? undefined,
        minAge: body.minAge ?? undefined,
        maxAge: body.maxAge ?? undefined,
        maxDistanceKm: body.maxDistanceKm ?? undefined,
        locationLat: body.locationLat ?? undefined,
        locationLng: body.locationLng ?? undefined,
        locationName: body.locationName ?? undefined,
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
