import { prisma } from "../../config/index.js";
import axios from "axios";
import { enqueueAnnouncement } from "../../services/announcement.service.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY;

export async function collectSourceIds(since: Date) {
  const [posts, threads, listings] = await Promise.all([
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
  ]);

  return [
    ...posts,
    ...threads,
    ...listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      body: listing.description,
    })),
  ];
}

export async function generateSummary(sources: { title: string | null; body: string }[]) {
  const text = sources.map((s) => (s.title ? s.title + ": " : "") + s.body).join("\n");
  if (!OPENAI_KEY || sources.length === 0) {
    // Heuristic fallback
    const headlines = sources.slice(0, 5).map((s) => (s.title ?? s.body.slice(0, 60)).trim());
    return {
      title: `Daily Brief - ${new Date().toISOString().slice(0, 10)}`,
      summary: headlines.length
        ? `Today's highlights:\n- ${headlines.join("\n- ")}`
        : "No new content today.",
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
    const headlines = sources.slice(0, 5).map((s) => (s.title ?? s.body.slice(0, 60)).trim());
    return { title: `Daily Brief`, summary: headlines.join("\n") };
  }
}

export async function runDailyBrief(date?: Date) {
  const d = date ?? new Date();
  const dayStart = new Date(d);
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  const sources = await collectSourceIds(since);
  const sourceIds = sources.map((s) => s.id);
  const { title, summary } = await generateSummary(sources);
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
  // Fan out via announcement
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
    // ignore fan-out failures
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
      },
    });
    await enqueueAnnouncement(ann.id);
  } catch {
    // ignore fan-out failures; the brief itself is published
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
