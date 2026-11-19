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
import { hashPhoneCandidates, hashPhoneNumber } from "../src/helpers/phoneHash.js";

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
          { phoneNumberHash: { not: null } },
          { phoneHash: { not: null } },
        ],
      },
      select: { id: true, phoneNumber: true, phoneNumberHash: true, phoneHash: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (users.length === 0) break;

    for (const user of users) {
      const phone = user.phoneNumber;
      const canonical = phone ? hashPhoneNumber(phone) : user.phoneNumberHash ?? user.phoneHash ?? null;
      const hashes = phone ? hashPhoneCandidates(phone) : canonical ? [canonical] : [];

      if (phone || canonical) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            phoneNumberHash: canonical,
            phoneHash: canonical,
          },
        });
      }

      if (hashes.length > 0) {
        try {
          await prisma.phoneHashVariant.deleteMany({ where: { userId: user.id } });
          await prisma.phoneHashVariant.createMany({
            data: hashes.map((hash) => ({ userId: user.id, hash })),
            skipDuplicates: true,
          });
        } catch (error) {
          console.warn(`Failed to write variants for ${user.id}`, error);
        }
      }

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
