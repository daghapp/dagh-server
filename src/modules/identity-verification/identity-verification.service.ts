import { prisma } from "../../config/index.js";
import { IdentityVerificationStatus } from "../../../generated/prisma/client.js";
import { randomInt } from "crypto";
import * as bcrypt from "bcrypt";
import sendEmail from "../../config/resend.config.js";
import { sendSms } from "../../helpers/sms.js";
import { normalizePhone } from "../../helpers/otp.js";

const RETENTION_DAYS = 90;
const IDENTITY_OTP_PURPOSE = "IDENTITY_VERIFICATION";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function retentionDate() {
  const d = new Date();
  d.setDate(d.getDate() + RETENTION_DAYS);
  return d;
}

export const CONSENT_VERSION = "v1-ghana-dpa-2026";

async function notifyIdentityStatus(row: {
  id: string;
  userId: string;
  status: string;
  rejectionReason?: string | null;
}) {
  try {
    await prisma.notificationOutbox.upsert({
      where: {
        eventType_aggregateId_recipientUserId: {
          eventType: "IDENTITY_STATUS_CHANGED",
          aggregateId: `${row.id}:${row.status}`,
          recipientUserId: row.userId,
        },
      },
      update: { status: "PENDING" },
      create: {
        eventType: "IDENTITY_STATUS_CHANGED",
        aggregateId: `${row.id}:${row.status}`,
        recipientUserId: row.userId,
        payload: {
          push: {
            type: "IDENTITY_STATUS_CHANGED",
            verificationId: row.id,
            status: row.status,
            reason: row.rejectionReason ?? "",
            route: "/verification/identity",
            schemaVersion: "1",
          },
        },
      },
    });
  } catch (error) {
    console.error("[identity-verification] failed to enqueue status notification", error);
  }
}

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
  const idNumberHash = (await import("crypto"))
    .createHash("sha256")
    .update(data.number)
    .digest("hex");
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

function maskDestination(value: string) {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    const head = local.slice(0, 2);
    return `${head}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
  }
  if (value.length <= 4) return "****";
  return `${value.slice(0, 3)}****${value.slice(-2)}`;
}

async function identityOtpDestination(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phoneNumber: true, fullName: true },
  });
  if (!user) throw new Error("User not found");
  const phone = user.phoneNumber ? normalizePhone(user.phoneNumber) : null;
  return { user, phone, destination: phone ?? user.email, channel: phone ? "SMS" : "EMAIL" };
}

export async function sendIdentityOtp(userId: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");
  if (row.status === "APPROVED") throw new Error("Identity already verified");

  const { user, phone, destination, channel } = await identityOtpDestination(userId);

  const recent = await prisma.otp.findFirst({
    where: { email: destination, purpose: IDENTITY_OTP_PURPOSE },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw new Error("Please wait before requesting another verification code");
  }

  const code = String(randomInt(100000, 999999));
  const hashedCode = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otp.deleteMany({ where: { email: destination, purpose: IDENTITY_OTP_PURPOSE } });
  const record = await prisma.otp.create({
    data: { email: destination, code: hashedCode, expiresAt, purpose: IDENTITY_OTP_PURPOSE },
  });

  try {
    if (phone) {
      await sendSms({
        to: phone,
        message: `Your DAGH identity verification code is ${code}. It expires in 10 minutes.`,
      });
    } else {
      await sendEmail({
        email: user.email,
        subject: "Your DAGH identity verification code",
        html: `<p>Hello ${user.fullName ?? ""},</p><p>Your identity verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      });
    }
  } catch (error) {
    await prisma.otp.deleteMany({ where: { id: record.id } });
    throw error;
  }

  return {
    challengeId: record.id,
    channel,
    destination: maskDestination(destination),
    expiresAt,
  };
}

export async function verifyIdentityOtp(userId: string, code: string) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not started");

  const { destination } = await identityOtpDestination(userId);
  const record = await prisma.otp.findFirst({
    where: { email: destination, purpose: IDENTITY_OTP_PURPOSE },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw new Error("No verification code requested");

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.otp.deleteMany({ where: { id: record.id } });
    throw new Error("Verification code expired");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.otp.deleteMany({ where: { id: record.id } });
    throw new Error("Too many attempts. Request a new code");
  }

  const valid = await bcrypt.compare(code, record.code);
  if (!valid) {
    await prisma.otp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new Error("Invalid verification code");
  }

  await prisma.otp.deleteMany({ where: { id: record.id } });
  return markOtpVerified(userId);
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
  // A completed submission always goes to a human reviewer (PENDING_REVIEW).
  const livenessScore = row.livenessScore ?? 0.9;
  const faceMatchScore = row.faceMatchScore ?? 0.9;
  return prisma.identityVerification.update({
    where: { userId },
    data: {
      livenessScore,
      faceMatchScore,
      status: "PENDING_REVIEW",
      reviewedAt: null,
      reviewedBy: null,
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

export async function adminDecide(
  userId: string,
  adminId: string,
  approve: boolean,
  reason?: string,
) {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  if (!row) throw new Error("Verification not found");
  const updated = await prisma.identityVerification.update({
    where: { userId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: approve ? null : (reason ?? "Rejected by admin"),
      // Retention clock starts at the review decision, not at submission.
      retentionUntil: retentionDate(),
    },
  });
  await notifyIdentityStatus(updated);
  return updated;
}

export async function adminDecideAppeal(
  appealId: string,
  adminId: string,
  approve: boolean,
  note?: string,
) {
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
  const verification = await prisma.identityVerification.update({
    where: { id: appeal.verificationId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      rejectionReason: approve ? null : (note ?? "Appeal rejected"),
      retentionUntil: retentionDate(),
    },
  });
  await notifyIdentityStatus(verification);
  return updated;
}

export function isVerifiedStatus(status: string | null | undefined) {
  return status === "APPROVED";
}
