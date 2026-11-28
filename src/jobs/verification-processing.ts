import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { withDistributedLock, tryAcquireWorkItem } from "../helpers/jobLock.js";

const JOB_LOCK_TTL_MS = 5 * 60 * 1000;
const WORK_ITEM_TTL_MS = 2 * 60 * 1000;
const BATCH_SIZE = 25;

/**
 * Scores liveness / face-match for completed identity submissions and moves
 * them into the human review queue. The provider calls are placeholders for v1;
 * swap `scoreSubmission` for the real biometric provider without changing the
 * queue contract.
 */
async function scoreSubmission(_row: {
  id: string;
  idFrontUrl: string | null;
  selfieUrl: string | null;
}): Promise<{ livenessScore: number; faceMatchScore: number }> {
  return { livenessScore: 0.9, faceMatchScore: 0.9 };
}

export async function processPendingVerifications(): Promise<number> {
  const rows = await prisma.identityVerification.findMany({
    where: {
      status: "IN_PROGRESS",
      idFrontUrl: { not: null },
      selfieUrl: { not: null },
      otpVerifiedAt: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: BATCH_SIZE,
  });

  let processed = 0;
  for (const row of rows) {
    const claimed = await tryAcquireWorkItem(`verification:${row.id}`, WORK_ITEM_TTL_MS);
    if (!claimed) continue;
    try {
      const scores = await scoreSubmission(row);
      await prisma.identityVerification.update({
        where: { id: row.id },
        data: {
          livenessScore: scores.livenessScore,
          faceMatchScore: scores.faceMatchScore,
          status: "PENDING_REVIEW",
        },
      });
      processed += 1;
    } catch (error) {
      console.error(`[verification-processing] failed for ${row.id}:`, error);
    }
  }
  return processed;
}

export function verificationProcessingJob() {
  cron.schedule(
    "*/2 * * * *",
    async () => {
      await withDistributedLock("verification-processing", JOB_LOCK_TTL_MS, async () => {
        try {
          const processed = await processPendingVerifications();
          if (processed > 0) {
            console.log(`✓ Verification processing: ${processed} submission(s) queued for review`);
          }
        } catch (error) {
          console.error("Verification processing job failed", error);
        }
      });
    },
    { timezone: "Africa/Accra" },
  );
  console.log("✓ Verification processing cron job initialized (every 2 minutes)");
}
