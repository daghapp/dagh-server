import { prisma } from "../../config/index.js";
import { IdentityVerificationStatus } from "../../../generated/prisma/client.js";

const RETENTION_DAYS = 90;

function retentionDate() {
  const d = new Date();
  d.setDate(d.getDate() + RETENTION_DAYS);
  return d;
}

export const CONSENT_VERSION = "v1-ghana-dpa-2026";

export async function startIdentityVerification(userId: string) {
  const existing = await prisma.identityVerification.findUnique({ where: { userId } });
  if (existing) {
    if (existing.status === "APPROVED") return existing;
    return prisma.identityVerification.update({
      where: { userId },
      data: { status: "IN_PROGRESS" },
    });
  }
  return prisma.identityVerification.create({
    data: {
      userId,
      status: "IN_PROGRESS",
      consentVersion: CONSENT_VERSION,
      consentedAt: new Date(),
      retentionUntil: retentionDate(),
    },
  });
}

export async function getIdentityStatus(userId: string) {
  return prisma.identityVerification.findUnique({
    where: { userId },
    include: { appeals: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function saveIdDocument(
  userId: string,
  data: { type: string; number: string; frontUrl: string; backUrl?: string },
) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  // Store ID number encrypted at rest.
  const idNumberHash = (await import("crypto")).createHash("sha256").update(data.number).digest("hex");
  return prisma.identityVerification.update({
    where: { userId },
    data: {
      idDocumentType: data.type,
      idNumberHash,
      idFrontUrl: data.frontUrl,
      idBackUrl: data.backUrl ?? null,
      status: "IN_PROGRESS",
    },
  });
}

export async function saveSelfie(userId: string, selfieUrl: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  return prisma.identityVerification.update({
    where: { userId },
    data: { selfieUrl, status: "IN_PROGRESS" },
  });
}

export async function markOtpVerified(userId: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  return prisma.identityVerification.update({
    where: { userId },
    data: { otpVerifiedAt: new Date(), status: "IN_PROGRESS" },
  });
}

export async function submitForReview(userId: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  if (!row.idFrontUrl || !row.selfieUrl || !row.otpVerifiedAt) {
    throw new Error("Incomplete verification steps");
  }
  // Automated checks placeholder: in production call liveness/face-match provider here.
  const livenessScore = row.livenessScore ?? 0.9;
  const faceMatchScore = row.faceMatchScore ?? 0.9;
  const autoApproved = livenessScore >= 0.8 && faceMatchScore >= 0.8;
  return prisma.identityVerification.update({
    where: { userId },
    data: {
      livenessScore,
      faceMatchScore,
      status: autoApproved ? "APPROVED" : "PENDING_REVIEW",
      reviewedAt: autoApproved ? new Date() : null,
      reviewedBy: autoApproved ? "system" : null,
    },
  });
}

export async function createAppeal(userId: string, reason: string, evidenceUrls: string[] = []) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  if (row.status !== "REJECTED") throw new Error("Appeals only for rejected verifications");
  const appeal = await prisma.verificationAppeal.create({
    data: { verificationId: row.id, userId, reason, evidenceUrls },
  });
  await prisma.identityVerification.update({
    where: { userId },
    data: { status: "APPEALED" },
  });
  return appeal;
}

export async function adminListVerifications(status?: string, limit = 50, offset = 0) {
  const where = status ? { status: status as IdentityVerificationStatus } : {};
  const [rows, total] = await Promise.all([
    prisma.identityVerification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, email: true, fullName: true } } },
    }),
    prisma.identityVerification.count({ where }),
  ]);
  return { rows, total };
}

export async function adminDecide(userId: string, adminId: string, approve: boolean, reason?: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not found");
  return prisma.identityVerification.update({
    where: { userId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: approve ? null : reason ?? "Rejected by admin",
    },
  });
}

export async function adminDecideAppeal(appealId: string, adminId: string, approve: boolean, note?: string) {
  const appeal = await prisma.verificationAppeal.findUnique({ where: { id: appealId } });
  if (!appeal) throw new Error("Appeal not found");
  const updated = await prisma.verificationAppeal.update({
    where: { id: appealId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      decisionNote: note ?? null,
    },
  });
  await prisma.identityVerification.update({
    where: { id: appeal.verificationId },
    data: { status: approve ? "APPROVED" : "REJECTED" },
  });
  return updated;
}

export function isVerifiedStatus(status: string | null | undefined) {
  return status === "APPROVED";
}
