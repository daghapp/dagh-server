import { prisma } from "../../config/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const LOCATION_FRESHNESS_MS = 30 * DAY_MS;

export type CuratedBriefItem = {
  id: string;
  title: string;
  body: string;
  route: string;
};

const CURATED_BASE: Record<string, { title: string; body: string; route: string }> = {
  "evergreen:heritage-weekend": {
    title: "3 hidden heritage spots in Nkonya Tepo, Cape Coast & Volta worth visiting this weekend",
    body: "Open the directory/itinerary tab to plan a weekend route.",
    route: "/itinerary",
  },
  "evergreen:acc-driver": {
    title: "Arriving at Kotoka (ACC) this week? Here’s how to book a vetted driver safely.",
    body: "Compare verified transport options before you travel.",
    route: "/itinerary",
  },
  "evergreen:diaspora-nearby": {
    title: "New diaspora members joined near Accra this week—say hello or spark a casual date.",
    body: "Say hello or spark a casual date.",
    route: "/dating/discovery",
  },
};

export async function buildCuratedBriefItems(now: Date): Promise<CuratedBriefItem[]> {
  const nearbyNewMembers = await prisma.user.count({
    where: {
      createdAt: { gte: new Date(now.getTime() - WEEK_MS) },
      accountStatus: "ACTIVE",
      isDeleted: false,
      discoveryPreference: {
        is: {
          locationName: { contains: "Accra", mode: "insensitive" },
          locationUpdatedAt: { gte: new Date(now.getTime() - LOCATION_FRESHNESS_MS) },
        },
      },
    },
  });
  const memberTitle =
    nearbyNewMembers > 0
      ? `${nearbyNewMembers} new diaspora members joined near Accra this week—say hello or spark a casual date.`
      : CURATED_BASE["evergreen:diaspora-nearby"].title;

  return Object.entries(CURATED_BASE).map(([id, item]) => ({
    id,
    title: id === "evergreen:diaspora-nearby" ? memberTitle : item.title,
    body: item.body,
    route: item.route,
  }));
}

export function curatedItemsFromBrief(sourceIds: string[], summary: string): CuratedBriefItem[] {
  const headlines = summary
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  return sourceIds.flatMap((id, index) => {
    const base = CURATED_BASE[id];
    if (!base) return [];
    return [{ id, title: headlines[index] ?? base.title, body: base.body, route: base.route }];
  });
}
