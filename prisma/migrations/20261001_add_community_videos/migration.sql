-- CreateTable
CREATE TYPE "VideoInteractionType" AS ENUM ('SUBSCRIBE_INTENT', 'PREVIEW_CLIP', 'WATCH_FULL_VIDEO', 'UNLOCK');

-- CreateTable
CREATE TABLE "community_videos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "teaserUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "action" "VideoInteractionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_videos_youtubeVideoId_key" ON "community_videos"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "video_interactions_userId_videoId_idx" ON "video_interactions"("userId", "videoId");

-- CreateIndex
CREATE INDEX "video_interactions_videoId_action_idx" ON "video_interactions"("videoId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "video_unlocks_userId_videoId_key" ON "video_unlocks"("userId", "videoId");

-- AddForeignKey
ALTER TABLE "video_interactions" ADD CONSTRAINT "video_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_interactions" ADD CONSTRAINT "video_interactions_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "community_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_unlocks" ADD CONSTRAINT "video_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_unlocks" ADD CONSTRAINT "video_unlocks_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "community_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;