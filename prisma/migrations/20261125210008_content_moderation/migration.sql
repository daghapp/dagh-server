-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('POST', 'COMMENT', 'FORUM_THREAD', 'LISTING', 'WEBINAR');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateTable
CREATE TABLE "content_posts" (
    "id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL DEFAULT 'POST',
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "aiScore" DOUBLE PRECISION,
    "aiLabels" TEXT[],
    "aiProvider" TEXT,
    "screenedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_appeals" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_posts_status_createdAt_idx" ON "content_posts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "content_posts_authorId_status_idx" ON "content_posts"("authorId", "status");

-- CreateIndex
CREATE INDEX "content_appeals_status_createdAt_idx" ON "content_appeals"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_appeals" ADD CONSTRAINT "content_appeals_postId_fkey" FOREIGN KEY ("postId") REFERENCES "content_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_appeals" ADD CONSTRAINT "content_appeals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
