import { describe, it, expect, beforeEach, vi } from "vitest";

delete process.env.OPENAI_API_KEY;

const prismaMock = {
  contentPost: { findMany: vi.fn() },
  forumThread: { findMany: vi.fn() },
  propertyListing: { findMany: vi.fn() },
  comment: { findMany: vi.fn() },
  user: { count: vi.fn() },
  dailyBrief: { upsert: vi.fn() },
  announcement: { create: vi.fn() },
};

const enqueueMock = vi.fn();

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/announcement.service.js", () => ({ enqueueAnnouncement: enqueueMock }));

const { runDailyBrief } = await import("../src/modules/daily-brief/daily-brief.service.js");
const { curatedItemsFromBrief } = await import("../src/modules/daily-brief/curated-content.js");

const NOW = new Date("2026-11-28T06:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentPost.findMany.mockResolvedValue([]);
  prismaMock.forumThread.findMany.mockResolvedValue([]);
  prismaMock.propertyListing.findMany.mockResolvedValue([]);
  prismaMock.comment.findMany.mockResolvedValue([]);
  prismaMock.user.count.mockResolvedValue(12);
  prismaMock.dailyBrief.upsert.mockImplementation(async ({ create }) => ({
    id: "brief-1",
    ...create,
  }));
  prismaMock.announcement.create.mockImplementation(async ({ data }) => ({ id: "ann-1", ...data }));
  enqueueMock.mockResolvedValue({ recipientCount: 1, deviceCount: 1, skippedCount: 0 });
});

describe("daily brief evergreen fallback", () => {
  it("publishes curated value when nothing was posted in the last 24 hours", async () => {
    const brief = await runDailyBrief(NOW);
    const upsert = prismaMock.dailyBrief.upsert.mock.calls[0][0];
    const summary = upsert.create.summary as string;

    expect(brief.status).toBe("PUBLISHED");
    expect(upsert.create.sourceIds).toEqual([
      "evergreen:heritage-weekend",
      "evergreen:acc-driver",
      "evergreen:diaspora-nearby",
    ]);
    expect(summary).toContain(
      "3 hidden heritage spots in Nkonya Tepo, Cape Coast & Volta worth visiting this weekend",
    );
    expect(summary).toContain("Arriving at Kotoka (ACC) this week?");
    expect(summary).toContain("12 new diaspora members joined near Accra this week");
    expect(summary).not.toContain("No new content today");
    expect(summary).not.toContain("→");

    const items = curatedItemsFromBrief(upsert.create.sourceIds, summary);
    expect(items).toEqual([
      {
        id: "evergreen:heritage-weekend",
        title:
          "3 hidden heritage spots in Nkonya Tepo, Cape Coast & Volta worth visiting this weekend",
        body: "Open the directory/itinerary tab to plan a weekend route.",
        route: "/itinerary",
      },
      {
        id: "evergreen:acc-driver",
        title: "Arriving at Kotoka (ACC) this week? Here’s how to book a vetted driver safely.",
        body: "Compare verified transport options before you travel.",
        route: "/itinerary",
      },
      {
        id: "evergreen:diaspora-nearby",
        title:
          "12 new diaspora members joined near Accra this week—say hello or spark a casual date.",
        body: "Say hello or spark a casual date.",
        route: "/dating/discovery",
      },
    ]);
  });

  it("does not send a push announcement when there is no user activity", async () => {
    await runDailyBrief(NOW);

    expect(prismaMock.announcement.create).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("uses a rolling 24-hour window and announces real activity", async () => {
    prismaMock.contentPost.findMany.mockResolvedValue([
      { id: "post-1", title: "Community update", body: "Body" },
    ]);

    await runDailyBrief(NOW);

    const since = prismaMock.contentPost.findMany.mock.calls[0][0].where.publishedAt.gte;
    expect(since.toISOString()).toBe("2026-11-27T06:00:00.000Z");
    expect(prismaMock.dailyBrief.upsert.mock.calls[0][0].create.sourceIds).toEqual(["post-1"]);
    expect(prismaMock.announcement.create).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith("ann-1");
  });

  it("treats an approved comment as real activity", async () => {
    prismaMock.comment.findMany.mockResolvedValue([{ id: "comment-1", body: "Great spot" }]);

    await runDailyBrief(NOW);

    expect(prismaMock.user.count).not.toHaveBeenCalled();
    expect(prismaMock.dailyBrief.upsert.mock.calls[0][0].create.sourceIds).toEqual(["comment-1"]);
    expect(prismaMock.announcement.create).toHaveBeenCalledTimes(1);
  });

  it("only claims Accra members with a recently refreshed location", async () => {
    await runDailyBrief(NOW);

    const where = prismaMock.user.count.mock.calls[0][0].where;
    const location = where.discoveryPreference.is;
    expect(location.locationName).toEqual({ contains: "Accra", mode: "insensitive" });
    expect(location.locationUpdatedAt.gte.toISOString()).toBe("2026-10-29T06:00:00.000Z");
  });
});
