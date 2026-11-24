import dns from "node:dns";
const _origLookup = dns.lookup;
(dns as any).lookup = function (hostname: string, options: any, callback: any) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  options = Object.assign({}, options, { family: 4 });
  return _origLookup(hostname, options, callback);
};
import "dotenv/config";
import { prisma } from "../src/config/index.js";
import { isFullyVerified } from "../src/helpers/verification-status.js";

async function main() {
  let cursor: string | undefined;
  let processed = 0;
  let approved = 0;

  for (;;) {
    const verifications = await prisma.profileVerification.findMany({
      where: {
        userProfile: { user: { datingProfile: { isNot: null } } },
      },
      select: {
        id: true,
        isVerified: true,
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
        faceStatus: true,
        documentStatus: true,
        bioDataStatus: true,
        userProfile: { select: { userId: true } },
      },
      orderBy: { id: "asc" },
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (verifications.length === 0) break;

    for (const verification of verifications) {
      processed += 1;
      const complete =
        verification.isVerified ||
        isFullyVerified({
          phone_number_verified: verification.phone_number_verified,
          bio_profile_verification: verification.bio_profile_verification,
          document_verification: verification.document_verification,
          faceStatus: verification.faceStatus,
          documentStatus: verification.documentStatus,
          bioDataStatus: verification.bioDataStatus,
        });
      if (!complete) continue;

      const userId = verification.userProfile.userId;
      const application = await prisma.datingApplication.findUnique({
        where: { userId },
        select: { status: true, reviewerId: true },
      });
      if (application?.status === "APPROVED") continue;

      const reviewedAt = new Date();
      await prisma.datingApplication.upsert({
        where: { userId },
        create: {
          userId,
          status: "APPROVED",
          reviewerId: application?.reviewerId ?? null,
          reviewedAt,
          notes: "Auto-approved from completed profile verification",
        },
        update: {
          status: "APPROVED",
          reviewerId: application?.reviewerId ?? null,
          reviewedAt,
        },
      });
      approved += 1;
    }

    cursor = verifications[verifications.length - 1]?.id;
    console.log(`Processed ${processed} verifications (approved ${approved})`);
  }

  console.log(`Done. Processed ${processed}, approved ${approved}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
