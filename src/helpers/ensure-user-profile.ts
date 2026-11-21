import { prisma } from "../config/index.js";

export async function ensureUserProfile(userId: string) {
  const existing = await prisma.userProfile.findUnique({
    where: { userId },
    include: { profileVerification: true },
  });

  if (existing) {
    if (!existing.profileVerification) {
      await prisma.profileVerification.create({
        data: {
          userProfileId: existing.id,
          phone_number_verified: false,
          isVerified: false,
          verification_message: null,
          lastUpdatedAt: new Date(),
          document_verification: false,
          bio_profile_verification: false,
          ip_address_verification: false,
        },
      });
      return prisma.userProfile.findUniqueOrThrow({
        where: { userId },
        include: { profileVerification: true },
      });
    }
    return existing;
  }

  return prisma.userProfile.create({
    data: {
      userId,
      profileUrl: null,
      phoneNumber: null,
      bio_profile_image_url: null,
      bio_profile_image_uploaded_at: null,
      bio_document_urls: [],
      bio_document_type: null,
      bio_document_uploaded_at: null,
      profileVerification: {
        create: {
          phone_number_verified: false,
          isVerified: false,
          verification_message: null,
          lastUpdatedAt: new Date(),
          document_verification: false,
          bio_profile_verification: false,
          ip_address_verification: false,
        },
      },
    },
    include: { profileVerification: true },
  });
}
