import { prisma } from "../../config/index.js";

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

export async function register(webinarId: string, userId: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Webinar not found");
  if (w.capacity && w.registeredCount >= w.capacity) throw new Error("At capacity");
  // paid requires payment confirmation separately; here free registration only
  if (w.isPaid) throw new Error("Paid webinar: complete payment first");
  const reg = await prisma.webinarRegistration.create({ data: { webinarId, userId, paid: false } });
  await prisma.webinar.update({
    where: { id: webinarId },
    data: { registeredCount: { increment: 1 } },
  });
  return reg;
}

export async function paidRegister(webinarId: string, userId: string, paymentRef: string) {
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Webinar not found");
  if (w.capacity && w.registeredCount >= w.capacity) throw new Error("At capacity");
  const reg = await prisma.webinarRegistration.create({
    data: { webinarId, userId, paid: true, paymentRef },
  });
  await prisma.webinar.update({
    where: { id: webinarId },
    data: { registeredCount: { increment: 1 } },
  });
  return reg;
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
  // Return a room token placeholder (LiveKit integration can issue real token)
  return { webinarId, userId, room: `webinar-${webinarId}`, token: `jwt-placeholder-${userId}` };
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
  const reg = await prisma.webinarRegistration.findUnique({
    where: { webinarId_userId: { webinarId, userId } },
  });
  if (!reg) throw new Error("Not registered");
  const w = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!w) throw new Error("Not found");
  return w.recordingUrl;
}
