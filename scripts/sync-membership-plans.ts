import { pathToFileURL } from "node:url";
import { prisma } from "../src/config/index.js";
import { membershipPlans } from "../src/seed-data/membership-plans.js";

export async function syncMembershipPlans() {
  let created = 0;

  for (const plan of membershipPlans) {
    const existing = await prisma.membershipPlan.findUnique({ where: { code: plan.code } });
    if (existing) continue;
    await prisma.membershipPlan.create({ data: plan });
    created += 1;
  }

  const active = await prisma.membershipPlan.count({ where: { isActive: true } });
  console.log(`Created ${created} membership plans.`);
  console.log(`Active membership plans: ${active}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncMembershipPlans()
    .catch((error) => {
      console.error("Membership-plan sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
