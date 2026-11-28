import { prisma } from "../../config/index.js";
import { PaymentStatus, PaymentTargetType } from "../../../generated/prisma/client.js";
import { generateLiveKitRoomToken } from "../../helpers/livekit.js";

export async function createWebinar(hostId: string, data: any) {
  return prisma.webinar.create({
    data: {
      hostId,
      title: data.title,
      description: data.description ?? null,
      startTime: new Date(data.startTime),
      durationMin: data.durationMin ?? 60,
      isPaid: !!data.isPaid,
      price: data.price ?? null,
      currency: data.currency ?? "GHS",
      capacity: data.capacity ?? null,
      status: "SCHEDULED",
    },
  });
}

export async function listWebinars(limit = 20, offset = 0) {
  const [rows, total] = await Promise.all([
    prisma.webinar.findMany({
      orderBy: { startTime: "asc" },
      take: limit,
      skip: offset,
      include: { host: { select: { id: true, fullName: true } } },
    }),
    prisma.webinar.count(),
  ]);
  return { rows, total };
}

export async function getWebinar(id: string) {
  const w = await prisma.webinar.findUnique({
    where: { id },
    include: { host: { select: { id: true, fullName: true } } },
  });
  if (!w) return null;
  // hide attendee identities: only count
  const count = await prisma.webinarRegistration.count({ where: { webinarId: id } });
  return { ...w, registeredCount: count };
}

async function registerWithCapacity(
  webinarId: string,
  userId: string,
  data: { paid: boolean; paymentRef?: string | null },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const w = await tx.webinar.findUnique({ where: { id: webinarId } });
      if (!w) throw new Error("Webinar not found");

      if (w.capacity != null) {
        const updated = await tx.webinar.updateMany({
          where: { id: webinarId, registeredCount: { lt: w.capacity } },
          data: { registeredCount: { increment: 1 } },
        });
        if (updated.count === 0) throw new Error("At capacity");
      } else {
        await tx.webinar.update({
          where: { id: webinarId },
          data: { registeredCount: { increment: 1 } },
        });
      }

      return tx.webinarRegistration.create({
        data: {
          webinarId,
          userId,
          paid: data.paid,
          paymentRef: data.paymentRef ?? null,
        },
      });
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new Error("Already registered", { cause: error });
    throw error;
  }
}

export async function register(webinarId: string, userId: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Webinar not found");
  if (w.isPaid) throw new Error("Paid webinar: complete payment first");
  return registerWithCapacity(webinarId, userId, { paid: false });
}

export async function paidRegister(webinarId: string, userId: string, paymentRef: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Webinar not found");
  if (!w.isPaid) throw new Error("Webinar is free; use the free registration endpoint");

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ reference: paymentRef }, { providerReference: paymentRef }],
      targetType: PaymentTargetType.WEBINAR_TICKET,
      targetId: webinarId,
      status: PaymentStatus.SUCCESS,
    },
  });
  if (!payment) throw new Error("Payment not confirmed for this webinar");

  return registerWithCapacity(webinarId, userId, { paid: true, paymentRef });
}

export async function join(webinarId: string, userId: string) {
  const reg = await prisma.webinarRegistration.findUnique({
    where: { webinarId_userId: { webinarId, userId } },
  });
  if (!reg) throw new Error("Not registered");
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Webinar not found");
  if (w.isPaid && !reg.paid) throw new Error("Payment required");
  await prisma.webinarRegistration.update({
    where: { id: reg.id },
    data: { joinedAt: new Date() },
  });

  const room = `webinar-${webinarId}`;
  const token = await generateLiveKitRoomToken({ roomId: room, identity: userId });
  if (token) {
    return { webinarId, userId, room, token: token.token, serviceUrl: token.serviceUrl };
  }
  return { webinarId, userId, room, token: `jwt-placeholder-${userId}` };
}

export async function uploadRecording(webinarId: string, hostId: string, recordingUrl: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w || w.hostId !== hostId) throw new Error("Not found or not host");
  return prisma.webinar.update({
    where: { id: webinarId },
    data: { recordingUrl, status: "COMPLETED" },
  });
}

export async function getRecording(webinarId: string, userId: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Not found");

  const isHost = w.hostId === userId;
  if (!isHost) {
    const reg = await prisma.webinarRegistration.findUnique({
      where: { webinarId_userId: { webinarId, userId } },
    });
    if (!reg) throw new Error("Not registered");
    if (w.isPaid && !reg.paid) throw new Error("Payment required");
  }
  if (!w.recordingUrl) throw new Error("Recording not available");
  return w.recordingUrl;
}
