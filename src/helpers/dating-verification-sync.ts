import { prisma } from "../config/index.js";

export async function approveDatingApplication(
  userId: string,
  reviewerId: string | null,
): Promise<void> {
  const existing = await prisma.datingApplication.findUnique({
    where: { userId },
    select: { reviewerId: true },
  });
  const reviewedAt = new Date();
  const effectiveReviewerId = reviewerId ?? existing?.reviewerId ?? null;
  await prisma.datingApplication.upsert({
    where: { userId },
    create: { userId, status: "APPROVED", reviewerId: effectiveReviewerId, reviewedAt },
    update: { status: "APPROVED", reviewerId: effectiveReviewerId, reviewedAt },
  });
}

export async function approveDatingApplicationForVerification(
  userProfileId: string,
  reviewerId: string | null,
): Promise<boolean> {
  const userProfile = await prisma.userProfile.findUnique({
    where: { id: userProfileId },
    select: { userId: true },
  });
  if (!userProfile) return false;

  await approveDatingApplication(userProfile.userId, reviewerId);
  return true;
}
