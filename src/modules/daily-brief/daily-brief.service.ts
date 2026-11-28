import { prisma } from "../../config/index.js";
import axios from "axios";
import { enqueueAnnouncement } from "../../services/announcement.service.js";
import { buildCuratedBriefItems } from "./curated-content.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DAY_MS = 24 * 60 * 60 * 1000;

type BriefSource = {
  id: string;
  title: string | null;
  body: string;
};

function formatHeadlines(sources: BriefSource[]) {
  return sources
    .slice(0, 5)
    .map((source) => `- ${(source.title ?? source.body.slice(0, 60)).trim()}`);
}

export async function collectSourceIds(since: Date): Promise<BriefSource[]> {
  const [posts, threads, listings, comments] = await Promise.all([
    prisma.contentPost.findMany({
      where: { status: "APPROVED", publishedAt: { gte: since } },
      select: { id: true, title: true, body: true },
      orderBy: { publishedAt: "desc" },
      take: 50,
    }),
    prisma.forumThread.findMany({
      where: { status: "APPROVED", createdAt: { gte: since } },
      select: { id: true, title: true, body: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.propertyListing.findMany({
      where: { status: "VERIFIED", updatedAt: { gte: since } },
      select: { id: true, title: true, description: true },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    prisma.comment.findMany({
      where: { status: "APPROVED", createdAt: { gte: since } },
      select: { id: true, body: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  return [
    ...posts,
    ...threads,
    ...listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      body: listing.description,
    })),
    ...comments.map((comment) => ({ id: comment.id, title: null, body: comment.body })),
  ];
}

export async function generateSummary(sources: BriefSource[], curated = false) {
  if (curated || sources.length === 0) {
    const items = sources.length ? sources : await buildCuratedBriefItems(new Date());
    return {
      title: `Daily Brief - ${new Date().toISOString().slice(0, 10)}`,
      summary: `Today's guide:\n${formatHeadlines(items).join("\n")}`,
    };
  }

  const text = sources.map((s) => (s.title ? s.title + ": " : "") + s.body).join("\n");
  if (!OPENAI_KEY) {
    return {
      title: `Daily Brief - ${new Date().toISOString().slice(0, 10)}`,
      summary: `Today's highlights:\n${formatHeadlines(sources).join("\n")}`,
    };
  }
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an editor. Summarize the day's community content into a concise daily brief (title + 3-5 bullet summary).",
          },
          { role: "user", content: text.slice(0, 8000) },
        ],
        temperature: 0.4,
      },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" } },
    );
    const content = res.data.choices?.[0]?.message?.content ?? "";
    const lines = content.split("\n").filter(Boolean);
    return { title: lines[0] ?? `Daily Brief`, summary: lines.slice(1).join("\n") || content };
  } catch {
    return {
      title: `Daily Brief`,
      summary: `Today's highlights:\n${formatHeadlines(sources).join("\n")}`,
    };
  }
}

export async function runDailyBrief(date?: Date) {
  const d = date ?? new Date();
  const dayStart = new Date(d);
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = new Date(d.getTime() - DAY_MS);
  const sources = await collectSourceIds(since);
  const hasUserActivity = sources.length > 0;
  const briefSources = hasUserActivity ? sources : await buildCuratedBriefItems(d);
  const sourceIds = briefSources.map((s) => s.id);
  const { title, summary } = await generateSummary(briefSources, !hasUserActivity);
  const brief = await prisma.dailyBrief.upsert({
    where: { date: dayStart },
    update: { title, summary, sourceIds, status: "PUBLISHED", publishedAt: new Date() },
    create: {
      date: dayStart,
      title,
      summary,
      sourceIds,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  if (hasUserActivity) {
    try {
      const ann = await prisma.announcement.create({
        data: {
          title,
          body: summary,
          category: "DAILY_BRIEF",
          audience: "ACTIVE",
          status: "DRAFT",
          createdBy: "system",
        },
      });
      await enqueueAnnouncement(ann.id);
    } catch {
      return brief;
    }
  }
  return brief;
}

export async function publishBrief(id: string) {
  const brief = await prisma.dailyBrief.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  try {
    const ann = await prisma.announcement.create({
      data: {
        title: brief.title,
        body: brief.summary,
        category: "DAILY_BRIEF",
        audience: "ACTIVE",
        status: "DRAFT",
        createdBy: "system",
        route: brief.sourceIds.some((id) => id.startsWith("evergreen:")) ? "/itinerary" : null,
      },
    });
    await enqueueAnnouncement(ann.id);
  } catch {
    return brief;
  }
  return brief;
}

export async function getLatest() {
  return prisma.dailyBrief.findFirst({ orderBy: { date: "desc" } });
}

export async function getByDate(date: string) {
  return prisma.dailyBrief.findUnique({ where: { date: new Date(date) } });
}

export async function listBriefs(limit = 20, offset = 0) {
  const [rows, total] = await Promise.all([
    prisma.dailyBrief.findMany({ orderBy: { date: "desc" }, take: limit, skip: offset }),
    prisma.dailyBrief.count(),
  ]);
  return { rows, total };
}
