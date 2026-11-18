import { prisma } from "../src/config/index.js";
import {
  ensureDatingSearchIndex,
  indexDatingProfile,
  isDatingSearchEnabled,
} from "../src/services/dating-search.service.js";

async function main() {
  if (!isDatingSearchEnabled()) {
    console.error("OpenSearch is not configured. Set OPENSEARCH_NODE first.");
    process.exitCode = 1;
    return;
  }

  if (!(await ensureDatingSearchIndex())) {
    console.error("Could not create/verify the OpenSearch index.");
    process.exitCode = 1;
    return;
  }

  const profiles = await prisma.datingProfile.findMany({ select: { userId: true } });
  console.log(`Indexing ${profiles.length} dating profiles...`);

  for (const { userId } of profiles) {
    await indexDatingProfile(userId);
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
