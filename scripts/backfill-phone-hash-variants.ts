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
import crypto from "node:crypto";
import { prisma } from "../src/config/index.js";
import { hashPhoneLookupCandidates, hashPhoneNumber } from "../src/helpers/phoneHash.js";

async function main() {
  const batchSize = 250;
  let cursor: string | undefined;
  let processed = 0;
  let updated = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { phoneNumber: { not: null } },
          { profile: { is: { phoneNumber: { not: null } } } },
        ],
      },
      select: {
        id: true,
        phoneNumber: true,
        phoneNumberHash: true,
        phoneHash: true,
        profile: { select: { phoneNumber: true } },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (users.length === 0) break;

    for (const user of users) {
      const phone = user.phoneNumber ?? user.profile?.phoneNumber ?? null;
      if (!phone) continue;
      const hashes = hashPhoneLookupCandidates(phone);
      if (hashes.length === 0) continue;

      const canonical = hashPhoneNumber(phone);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          phoneNumberHash: canonical,
          phoneHash: canonical,
        },
      });

      await prisma.phoneHashVariant.deleteMany({ where: { userId: user.id } });
      await prisma.phoneHashVariant.createMany({
        data: hashes.map((hash) => ({ id: crypto.randomUUID(), userId: user.id, hash })),
        skipDuplicates: true,
      });

      updated += 1;
    }

    processed += users.length;
    cursor = users[users.length - 1]?.id;
    console.log(`Processed ${processed} users (updated ${updated})`);
  }

  console.log(`Done. Processed ${processed}, updated ${updated}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
