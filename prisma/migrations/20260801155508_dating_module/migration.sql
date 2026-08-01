-- CreateEnum
CREATE TYPE "LookingFor" AS ENUM ('LONG_TERM_PARTNER', 'SHORT_TERM', 'FRIENDSHIP', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "SwipeDirection" AS ENUM ('LIKE', 'SUPER_LIKE', 'PASS');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'VOICE_NOTE', 'IMAGE', 'VIDEO', 'CALL_LOG');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('MISSED', 'COMPLETED', 'DECLINED', 'BUSY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "mediaDuration" INTEGER,
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT',
ALTER COLUMN "content" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_matches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchedId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'MATCHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dating_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "photos" TEXT[],
    "heightCm" INTEGER,
    "interests" TEXT[],
    "lookingFor" "LookingFor",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_swipes" (
    "id" TEXT NOT NULL,
    "swiperId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "direction" "SwipeDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lookingFor" "LookingFor",
    "genderPreference" "Gender"[],
    "minAge" INTEGER NOT NULL DEFAULT 18,
    "maxAge" INTEGER NOT NULL DEFAULT 60,
    "maxDistanceKm" INTEGER NOT NULL DEFAULT 50,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "locationName" TEXT,
    "showProfile" BOOLEAN NOT NULL DEFAULT true,
    "showOnlineStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "datingProfileId" TEXT NOT NULL,

    CONSTRAINT "discovery_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "callType" "CallType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'MISSED',
    "roomId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER DEFAULT 0,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_matches_userId_matchedId_key" ON "user_matches"("userId", "matchedId");

-- CreateIndex
CREATE UNIQUE INDEX "dating_profiles_userId_key" ON "dating_profiles"("userId");

-- CreateIndex
CREATE INDEX "user_swipes_targetId_idx" ON "user_swipes"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "user_swipes_swiperId_targetId_key" ON "user_swipes"("swiperId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_preferences_userId_key" ON "discovery_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_preferences_datingProfileId_key" ON "discovery_preferences"("datingProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blockerId_blockedId_key" ON "user_blocks"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "call_logs_callerId_idx" ON "call_logs"("callerId");

-- CreateIndex
CREATE INDEX "call_logs_receiverId_idx" ON "call_logs"("receiverId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_matches" ADD CONSTRAINT "user_matches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_matches" ADD CONSTRAINT "user_matches_matchedId_fkey" FOREIGN KEY ("matchedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dating_profiles" ADD CONSTRAINT "dating_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_swipes" ADD CONSTRAINT "user_swipes_swiperId_fkey" FOREIGN KEY ("swiperId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_swipes" ADD CONSTRAINT "user_swipes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_preferences" ADD CONSTRAINT "discovery_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_preferences" ADD CONSTRAINT "discovery_preferences_datingProfileId_fkey" FOREIGN KEY ("datingProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
