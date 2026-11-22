import { prisma } from "../config/index.js";

export async function isProfileVerified(userId: string): Promise<boolean> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      include: { profileVerification: true },
    });
    return profile?.profileVerification?.isVerified === true;
  } catch {
    return false;
  }
}

export async function requireVerifiedProfile(userId: string): Promise<boolean> {
  return isProfileVerified(userId);
}

export const isVerifiedProfile = isProfileVerified;
