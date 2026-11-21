import { pathToFileURL } from "node:url";
import { prisma } from "../src/config/index.js";
import { communityVideos } from "../src/seed-data/community-videos.js";
import { buildPreviewEmbedUrl } from "../src/services/youtube.service.js";

export async function syncCommunityVideos(dryRun = process.argv.includes("--dry-run")) {
  console.log(`${dryRun ? "[dry-run] " : ""}Syncing ${communityVideos.length} community videos...`);

  const existing = await prisma.communityVideo.findMany({
    where: { youtubeVideoId: { in: communityVideos.map((video) => video.youtubeVideoId) } },
    select: {
      id: true,
      youtubeVideoId: true,
      title: true,
      description: true,
      teaserUrl: true,
      thumbnailUrl: true,
      statsSyncedAt: true,
      viewCount: true,
      likeCount: true,
    },
  });
  const byVideoId = new Map(existing.map((video) => [video.youtubeVideoId, video]));
  const syncedAt = new Date();

  let created = 0;
  let enriched = 0;

  for (const video of communityVideos) {
    const current = byVideoId.get(video.youtubeVideoId);
    const data = {
      title: video.title,
      description: video.description,
      teaserUrl: buildPreviewEmbedUrl(video.youtubeVideoId),
      thumbnailUrl: video.thumbnailUrl,
      youtubeVideoId: video.youtubeVideoId,
      isPublished: true,
      publishedAt: new Date(video.publishedAt),
      previewStartSeconds: 0,
      previewDurationSeconds: 30,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      statsSyncedAt: syncedAt,
    };

    if (!current) {
      if (!dryRun) await prisma.communityVideo.create({ data });
      created += 1;
      continue;
    }

    const patch: {
      description?: string;
      teaserUrl?: string;
      thumbnailUrl?: string;
      viewCount?: number;
      likeCount?: number;
      statsSyncedAt?: Date;
    } = {};
    if (!current.description) patch.description = data.description;
    if (!current.teaserUrl) patch.teaserUrl = data.teaserUrl;
    if (!current.thumbnailUrl) patch.thumbnailUrl = data.thumbnailUrl;
    if (!current.statsSyncedAt) {
      patch.viewCount = data.viewCount;
      patch.likeCount = data.likeCount;
      patch.statsSyncedAt = syncedAt;
    }

    if (Object.keys(patch).length > 0) {
      if (!dryRun) await prisma.communityVideo.update({ where: { id: current.id }, data: patch });
      enriched += 1;
    }
  }

  const published = await prisma.communityVideo.count({ where: { isPublished: true } });
  console.log(`${dryRun ? "Would create" : "Created"} ${created} community videos.`);
  console.log(`${dryRun ? "Would enrich" : "Enriched"} ${enriched} existing community videos.`);
  console.log(`Published community videos: ${published}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncCommunityVideos()
    .catch((error) => {
      console.error("Community-video sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
