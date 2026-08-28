import { prisma } from "../config/index.js";

export const isUserBlocked = async (userA: string, userB: string): Promise<boolean> => {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
  });
  return !!block;
};
