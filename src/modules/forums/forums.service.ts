import { prisma } from "../../config/index.js";
import { ModerationStatus as MS } from "../../../generated/prisma/client.js";
import { getRedisClient } from "../../config/redis.js";
import { screenContent } from "../content-moderation/content-moderation.service.js";

const AUTO_APPROVE = 0.3;
const FLAG = 0.7;

async function cacheGet(key: string): Promise<any> {
  const r = getRedisClient();
  if (!r) return null;
  try {
    const v = await r.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, val: any, ttl = 60): Promise<void> {
  const r = getRedisClient();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(val), { EX: ttl });
  } catch {
    // ignore
  }
}

async function cacheDelPattern(pattern: string): Promise<void> {
  const r = getRedisClient();
  if (!r) return;
  try {
    const keys = await r.keys(pattern);
    for (const key of keys) {
      await r.del(key);
    }
  } catch {
    // ignore
  }
}

export async function listForums() {
  return prisma.forum.findMany({ orderBy: { name: "asc" } });
}

export async function createForum(data: { slug: string; name: string; description?: string }) {
  return prisma.forum.create({ data });
}

export async function listThreads(forumSlug: string, limit = 20, offset = 0) {
  const key = `forum:threads:${forumSlug}:${limit}:${offset}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const forum = await prisma.forum.findUnique({ where: { slug: forumSlug } });
  if (!forum) throw new Error("Forum not found");
  const where = { forumId: forum.id, status: MS.APPROVED };
  const [rows, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }],
      take: limit,
      skip: offset,
      include: { author: { select: { id: true, fullName: true } } },
    }),
    prisma.forumThread.count({ where }),
  ]);
  const res = { forum, rows, total };
  await cacheSet(key, res, 60);
  return res;
}

export async function createThread(
  authorId: string,
  forumSlug: string,
  data: { title: string; body: string },
) {
  const forum = await prisma.forum.findUnique({ where: { slug: forumSlug } });
  if (!forum) throw new Error("Forum not found");
  const res = await screenContent(data.body + " " + data.title);
  const status = (
    res.score < AUTO_APPROVE ? MS.APPROVED : res.score < FLAG ? MS.FLAGGED : MS.REJECTED
  ) as MS;
  const thread = await prisma.forumThread.create({
    data: {
      forumId: forum.id,
      authorId,
      title: data.title,
      body: data.body,
      status,
    },
  });
  await cacheDelPattern(`forum:threads:${forumSlug}:*`);
  return thread;
}

export async function getThread(id: string) {
  return prisma.forumThread.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, fullName: true } },
      comments: {
        where: { status: MS.APPROVED },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, fullName: true } } },
      },
    },
  });
}

export async function createComment(
  authorId: string,
  threadId: string,
  body: string,
  parentId?: string,
) {
  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    include: { forum: { select: { slug: true } } },
  });
  if (!thread) throw new Error("Thread not found");
  if (thread.locked) throw new Error("Thread locked");
  const res = await screenContent(body);
  const status = (
    res.score < AUTO_APPROVE ? MS.APPROVED : res.score < FLAG ? MS.FLAGGED : MS.REJECTED
  ) as MS;
  const comment = await prisma.comment.create({
    data: { threadId, authorId, body, parentId: parentId ?? null, status },
  });
  if (status === MS.APPROVED) {
    await prisma.forumThread.update({
      where: { id: threadId },
      data: { replyCount: { increment: 1 }, lastActivityAt: new Date() },
    });
  }
  await cacheDelPattern(`forum:threads:${thread.forum.slug}:*`);
  return comment;
}

export async function updateThread(
  id: string,
  userId: string,
  isAdmin: boolean,
  data: { title?: string; body?: string },
) {
  const thread = await prisma.forumThread.findUnique({
    where: { id },
    include: { forum: { select: { slug: true } } },
  });
  if (!thread) throw new Error("Thread not found");
  if (!isAdmin && thread.authorId !== userId) throw new Error("Not allowed");
  if (thread.locked && !isAdmin) throw new Error("Thread locked");

  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.body !== undefined) {
    update.body = data.body;
    const res = await screenContent(`${data.title ?? thread.title} ${data.body}`);
    update.status = (
      res.score < AUTO_APPROVE ? MS.APPROVED : res.score < FLAG ? MS.FLAGGED : MS.REJECTED
    ) as MS;
  }
  const updated = await prisma.forumThread.update({ where: { id }, data: update });
  await cacheDelPattern(`forum:threads:${thread.forum.slug}:*`);
  return updated;
}

export async function deleteThread(id: string, userId: string, isAdmin: boolean) {
  const thread = await prisma.forumThread.findUnique({
    where: { id },
    include: { forum: { select: { slug: true } } },
  });
  if (!thread) throw new Error("Thread not found");
  if (!isAdmin && thread.authorId !== userId) throw new Error("Not allowed");
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { threadId: id } }),
    prisma.forumThread.delete({ where: { id } }),
  ]);
  await cacheDelPattern(`forum:threads:${thread.forum.slug}:*`);
  return { id };
}

export async function updateComment(id: string, userId: string, isAdmin: boolean, body: string) {
  const comment = await prisma.comment.findUnique({
    where: { id },
    include: { thread: { include: { forum: { select: { slug: true } } } } },
  });
  if (!comment) throw new Error("Comment not found");
  if (!isAdmin && comment.authorId !== userId) throw new Error("Not allowed");
  const res = await screenContent(body);
  const status = (
    res.score < AUTO_APPROVE ? MS.APPROVED : res.score < FLAG ? MS.FLAGGED : MS.REJECTED
  ) as MS;
  const updated = await prisma.comment.update({
    where: { id },
    data: { body, status },
  });
  if (comment.thread) {
    await cacheDelPattern(`forum:threads:${comment.thread.forum.slug}:*`);
  }
  return updated;
}

export async function deleteComment(id: string, userId: string, isAdmin: boolean) {
  const comment = await prisma.comment.findUnique({
    where: { id },
    include: { thread: { include: { forum: { select: { slug: true } } } } },
  });
  if (!comment) throw new Error("Comment not found");
  if (!isAdmin && comment.authorId !== userId) throw new Error("Not allowed");
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { parentId: id } }),
    prisma.comment.delete({ where: { id } }),
  ]);
  if (comment.thread) {
    await cacheDelPattern(`forum:threads:${comment.thread.forum.slug}:*`);
  }
  return { id };
}

export async function moderateThread(
  id: string,
  adminId: string,
  approve: boolean,
  reason?: string,
) {
  return prisma.forumThread.update({
    where: { id },
    data: { status: approve ? MS.APPROVED : MS.REJECTED },
  });
}

export async function moderateComment(
  id: string,
  adminId: string,
  approve: boolean,
  reason?: string,
) {
  return prisma.comment.update({
    where: { id },
    data: { status: approve ? MS.APPROVED : MS.REJECTED },
  });
}

export async function listPendingThreads(status = "PENDING", limit = 50, offset = 0) {
  const where = { status: status as MS };
  const [rows, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { author: { select: { id: true, fullName: true } } },
    }),
    prisma.forumThread.count({ where }),
  ]);
  return { rows, total };
}

export async function listPendingComments(status = "PENDING", limit = 50, offset = 0) {
  const where = { status: status as MS };
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.comment.count({ where }),
  ]);
  return { rows, total };
}
