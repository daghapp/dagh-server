import { prisma } from "../../config/index.js";
import { ContentKind as CK, ModerationStatus as MS } from "../../../generated/prisma/client.js";

export const AUTO_APPROVE_THRESHOLD = 0.3;
export const FLAG_THRESHOLD = 0.7;

// Placeholder AI screening. Replace with real provider (OpenAI Moderation / Azure Content Safety).
export async function screenContent(
  text: string,
): Promise<{ score: number; labels: string[]; provider: string }> {
  const lower = text.toLowerCase();
  const labels: string[] = [];
  let score = 0.05;
  if (/\b(spam|buy now|click here)\b/.test(lower)) {
    labels.push("spam");
    score = Math.max(score, 0.6);
  }
  if (/\b(hate|kill|idiot)\b/.test(lower)) {
    labels.push("hate");
    score = Math.max(score, 0.8);
  }
  return { score, labels, provider: "local-heuristic" };
}

async function notifyContentStatus(post: {
  id: string;
  authorId: string;
  status: string;
  rejectionReason?: string | null;
}) {
  try {
    await prisma.notificationOutbox.upsert({
      where: {
        eventType_aggregateId_recipientUserId: {
          eventType: "CONTENT_STATUS_CHANGED",
          aggregateId: `${post.id}:${post.status}`,
          recipientUserId: post.authorId,
        },
      },
      update: { status: "PENDING" },
      create: {
        eventType: "CONTENT_STATUS_CHANGED",
        aggregateId: `${post.id}:${post.status}`,
        recipientUserId: post.authorId,
        payload: {
          push: {
            type: "CONTENT_STATUS_CHANGED",
            contentId: post.id,
            status: post.status,
            reason: post.rejectionReason ?? "",
            route: `/content/posts/${post.id}`,
            schemaVersion: "1",
          },
        },
      },
    });
  } catch (error) {
    console.error("[content-moderation] failed to enqueue status notification", error);
  }
}

export async function createPost(
  authorId: string,
  data: { kind?: string; title?: string; body: string; mediaUrls?: string[] },
) {
  const post = await prisma.contentPost.create({
    data: {
      authorId,
      kind: (data.kind as CK) ?? CK.POST,
      title: data.title ?? null,
      body: data.body,
      mediaUrls: data.mediaUrls ?? [],
      status: "PENDING",
    },
  });
  // Screen synchronously for v1; move to job for scale.
  const result = await screenContent(data.body);
  const status =
    result.score < AUTO_APPROVE_THRESHOLD
      ? "APPROVED"
      : result.score < FLAG_THRESHOLD
        ? "FLAGGED"
        : "REJECTED";
  const updated = await prisma.contentPost.update({
    where: { id: post.id },
    data: {
      aiScore: result.score,
      aiLabels: result.labels,
      aiProvider: result.provider,
      screenedAt: new Date(),
      status: status as MS,
      publishedAt: status === "APPROVED" ? new Date() : null,
      rejectionReason: status === "REJECTED" ? "Rejected by automated screening" : null,
    },
  });
  await notifyContentStatus(updated);
  return updated;
}

function statusForScore(score: number): MS {
  if (score < AUTO_APPROVE_THRESHOLD) return MS.APPROVED;
  if (score < FLAG_THRESHOLD) return MS.FLAGGED;
  return MS.REJECTED;
}

/**
 * Re-screens PENDING posts (e.g. resubmitted through an appeal). Returns the
 * number of posts that were processed.
 */
export async function screenPendingPosts(batchSize = 25): Promise<number> {
  const posts = await prisma.contentPost.findMany({
    where: { status: MS.PENDING },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
  let processed = 0;
  for (const post of posts) {
    const result = await screenContent(post.body);
    const status = statusForScore(result.score);
    const updated = await prisma.contentPost.update({
      where: { id: post.id },
      data: {
        aiScore: result.score,
        aiLabels: result.labels,
        aiProvider: result.provider,
        screenedAt: new Date(),
        status,
        publishedAt: status === MS.APPROVED ? new Date() : null,
        rejectionReason: status === MS.REJECTED ? "Rejected by automated screening" : null,
      },
    });
    await notifyContentStatus(updated);
    processed += 1;
  }
  return processed;
}

export async function listQueue(status: string, limit = 50, offset = 0) {
  const where = status && status !== "ALL" ? { status: status as MS } : {};
  const [rows, total] = await Promise.all([
    prisma.contentPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { author: { select: { id: true, email: true, fullName: true } } },
    }),
    prisma.contentPost.count({ where }),
  ]);
  return { rows, total };
}

export async function decidePost(
  postId: string,
  adminId: string,
  approve: boolean,
  reason?: string,
) {
  const updated = await prisma.contentPost.update({
    where: { id: postId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: approve ? null : (reason ?? "Rejected by moderator"),
      publishedAt: approve ? new Date() : null,
    },
  });
  await notifyContentStatus(updated);
  return updated;
}

export async function createAppeal(postId: string, userId: string, reason: string) {
  const post = await prisma.contentPost.findUnique({ where: { id: postId } });
  if (!post) throw new Error("Post not found");
  if (post.authorId !== userId) throw new Error("Not your post");
  if (post.status !== "REJECTED" && post.status !== "FLAGGED")
    throw new Error("Appeals only for rejected/flagged posts");
  const appeal = await prisma.contentAppeal.create({ data: { postId, userId, reason } });
  const updated = await prisma.contentPost.update({
    where: { id: postId },
    data: { status: "PENDING" },
  });
  await notifyContentStatus(updated);
  return appeal;
}

export async function decideAppeal(
  appealId: string,
  adminId: string,
  approve: boolean,
  note?: string,
) {
  const appeal = await prisma.contentAppeal.findUnique({ where: { id: appealId } });
  if (!appeal) throw new Error("Appeal not found");
  const updated = await prisma.contentAppeal.update({
    where: { id: appealId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      decisionNote: note ?? null,
    },
  });
  const post = await prisma.contentPost.update({
    where: { id: appeal.postId },
    data: { status: approve ? "APPROVED" : "REJECTED", publishedAt: approve ? new Date() : null },
  });
  await notifyContentStatus(post);
  return updated;
}

export async function getPost(id: string) {
  return prisma.contentPost.findUnique({
    where: { id },
    include: { author: { select: { id: true, email: true, fullName: true } } },
  });
}

export async function listApproved(limit = 50, offset = 0) {
  const where = { status: MS.APPROVED };
  const [rows, total] = await Promise.all([
    prisma.contentPost.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.contentPost.count({ where }),
  ]);
  return { rows, total };
}
