import { prisma } from "../config/index.js";
import { SubscriptionStatus } from "../../generated/prisma/client.js";

export const hasPaidActiveMembership = async (userId: string): Promise<boolean> => {
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
    select: { tierCode: true, status: true, endDate: true },
  });

  if (!subscription) return false;
  if (subscription.tierCode === "FREE") return false;
  if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
  if (subscription.endDate && subscription.endDate < new Date()) return false;
  return true;
};
