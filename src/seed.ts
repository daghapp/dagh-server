// import { PrismaClient } from "@prisma/client";
// impor

import { prisma } from "./config";
import type { Prisma } from "../generated/prisma/client.js";
import { Gender, LookingFor } from "../generated/prisma/enums.js";

// const prisma = new PrismaClient();

const tourSites: Prisma.TourSiteCreateInput[] = [
  // ── Greater Accra ──────────────────────────────────────────────────
  {
    name: "Kwame Nkrumah Mausoleum",
    region: "Greater Accra",
    latitude: 5.5502,
    longitude: -0.2009,
    description:
      "The final resting place of Ghana's first president and independence hero, surrounded by a beautifully landscaped park and museum.",
    imageUrl: null,
    category: "HISTORICAL",
  },
  {
    name: "Labadi Beach",
    region: "Greater Accra",
    latitude: 5.5559,
    longitude: -0.1496,
    description:
      "Accra's most popular public beach, known for lively weekends, local food, live music and stunning Atlantic views.",
    imageUrl: null,
    category: "BEACH",
  },
  {
    name: "Shai Hills Resource Reserve",
    region: "Greater Accra",
    latitude: 5.9167,
    longitude: -0.05,
    description:
      "A scenic reserve just outside Accra with baboons, antelopes, caves, and ancient Shai people settlements.",
    imageUrl: null,
    category: "WILDLIFE",
  },
  // ── Eastern Region ─────────────────────────────────────────────────
  {
    name: "Aburi Botanical Gardens",
    region: "Eastern",
    latitude: 5.8478,
    longitude: -0.1747,
    description:
      "Established in 1890, these lush highland gardens sit 450m above sea level and offer a cool escape from the city with exotic flora.",
    imageUrl: null,
    category: "NATURE",
  },
  {
    name: "Boti Falls",
    region: "Eastern",
    latitude: 6.5333,
    longitude: -0.1,
    description:
      "A twin waterfall in the Yilo Krobo district, surrounded by lush forest. The two streams merge during the rainy season.",
    imageUrl: null,
    category: "NATURE",
  },
  {
    name: "Akosombo Dam",
    region: "Eastern",
    latitude: 6.2993,
    longitude: 0.0597,
    description:
      "One of the largest hydroelectric dams in the world, creating Lake Volta — the world's largest man-made lake by surface area.",
    imageUrl: null,
    category: "SCENIC",
  },
  {
    name: "Krobo Beads Market",
    region: "Eastern",
    latitude: 6.0833,
    longitude: -0.0833,
    description:
      "A vibrant cultural market in the Krobo District famous for handmade Krobo beads, one of Ghana's most iconic traditional crafts.",
    imageUrl: null,
    category: "CULTURAL",
  },
  // ── Central Region ─────────────────────────────────────────────────
  {
    name: "Cape Coast Castle",
    region: "Central",
    latitude: 5.1031,
    longitude: -1.2425,
    description:
      "A UNESCO World Heritage Site and one of the most significant slave castles on the West African coast.",
    imageUrl: null,
    category: "HISTORICAL",
  },
  {
    name: "Elmina Castle",
    region: "Central",
    latitude: 5.0847,
    longitude: -1.3497,
    description:
      "Built by the Portuguese in 1482, Elmina Castle is the oldest European building in sub-Saharan Africa and a UNESCO World Heritage Site.",
    imageUrl: null,
    category: "HISTORICAL",
  },
  {
    name: "Kakum National Park",
    region: "Central",
    latitude: 5.35,
    longitude: -1.3833,
    description:
      "Famous for its canopy walkway suspended 30m above the forest floor, home to forest elephants, leopards and over 350 bird species.",
    imageUrl: null,
    category: "WILDLIFE",
  },
  // ── Western Region ─────────────────────────────────────────────────
  {
    name: "Busua Beach",
    region: "Western",
    latitude: 4.7333,
    longitude: -1.9667,
    description:
      "One of Ghana's finest beaches, known for safe swimming, surfing, and a laid-back fishing village atmosphere.",
    imageUrl: null,
    category: "BEACH",
  },
  {
    name: "Nzulezo Stilt Village",
    region: "Western",
    latitude: 4.9833,
    longitude: -2.4667,
    description:
      "A remarkable village built entirely on stilts over Lake Tadane, inhabited for over 500 years. Accessible only by dugout canoe.",
    imageUrl: null,
    category: "CULTURAL",
  },
  {
    name: "Ankasa Conservation Area",
    region: "Western",
    latitude: 5.2667,
    longitude: -2.6833,
    description:
      "Ghana's only remaining primary rainforest, home to chimpanzees, forest elephants, and extraordinary bird life.",
    imageUrl: null,
    category: "WILDLIFE",
  },
  // ── Volta Region ───────────────────────────────────────────────────
  {
    name: "Wli Waterfalls",
    region: "Volta",
    latitude: 7.0667,
    longitude: 0.6333,
    description:
      "The highest waterfall in West Africa at 80m, nested in the Agumatsa Wildlife Sanctuary near the Togo border.",
    imageUrl: null,
    category: "NATURE",
  },
  {
    name: "Mount Afadjato",
    region: "Volta",
    latitude: 6.9833,
    longitude: 0.5833,
    description:
      "Ghana's highest peak at 885m above sea level, offering panoramic views across the Volta Region into Togo.",
    imageUrl: null,
    category: "SCENIC",
  },
  {
    name: "Tafi Atome Monkey Sanctuary",
    region: "Volta",
    latitude: 7.3333,
    longitude: 0.4167,
    description:
      "A community-run sanctuary where sacred Mona monkeys roam freely and visitors can hand-feed them.",
    imageUrl: null,
    category: "WILDLIFE",
  },
  // ── Ashanti Region ─────────────────────────────────────────────────
  {
    name: "Manhyia Palace Museum",
    region: "Ashanti",
    latitude: 6.7,
    longitude: -1.6167,
    description:
      "The official seat of the Asantehene, showcasing Ashanti royal history, regalia, and culture.",
    imageUrl: null,
    category: "CULTURAL",
  },
  {
    name: "Kejetia Market",
    region: "Ashanti",
    latitude: 6.6954,
    longitude: -1.6233,
    description:
      "One of the largest open-air markets in West Africa — a sensory explosion of kente cloth, spices and local crafts.",
    imageUrl: null,
    category: "CULTURAL",
  },
  {
    name: "Lake Bosomtwe",
    region: "Ashanti",
    latitude: 6.4833,
    longitude: -1.4167,
    description:
      "Ghana's only natural lake, formed by a meteorite impact. Sacred to the Ashanti people, offering swimming and beautiful scenery.",
    imageUrl: null,
    category: "SCENIC",
  },
  // ── Bono East ──────────────────────────────────────────────────────
  {
    name: "Kintampo Waterfalls",
    region: "Bono East",
    latitude: 8.05,
    longitude: -1.7333,
    description:
      "A beautiful three-tiered waterfall at the geographical centre of Ghana, with natural swimming pools.",
    imageUrl: null,
    category: "NATURE",
  },
  // ── Northern / Savannah ────────────────────────────────────────────
  {
    name: "Mole National Park",
    region: "Savannah",
    latitude: 9.2667,
    longitude: -1.85,
    description:
      "Ghana's largest wildlife refuge and premier safari destination, home to elephants, hippos, warthogs, baboons and 300+ bird species.",
    imageUrl: null,
    category: "WILDLIFE",
  },
  {
    name: "Larabanga Mosque",
    region: "Savannah",
    latitude: 9.2333,
    longitude: -1.8667,
    description:
      "One of the oldest mosques in West Africa, built in Sudanese architectural style, believed to date back to 1421.",
    imageUrl: null,
    category: "RELIGIOUS",
  },
  {
    name: "Tamale Central Mosque",
    region: "Northern",
    latitude: 9.4008,
    longitude: -0.8393,
    description:
      "The largest mosque in Ghana and one of the most iconic in West Africa, a landmark of Islamic heritage.",
    imageUrl: null,
    category: "RELIGIOUS",
  },
  // ── Upper East ─────────────────────────────────────────────────────
  {
    name: "Paga Crocodile Pond",
    region: "Upper East",
    latitude: 10.9833,
    longitude: -1.1167,
    description:
      "A sacred pond where wild crocodiles are considered ancestral spirits of the community and can be safely touched.",
    imageUrl: null,
    category: "CULTURAL",
  },
  {
    name: "Bolgatanga Market",
    region: "Upper East",
    latitude: 10.7833,
    longitude: -0.85,
    description:
      "A vibrant regional market famous for hand-woven baskets, leather goods and traditional crafts unique to the Upper East.",
    imageUrl: null,
    category: "CULTURAL",
  },
];

// ── Dating module demo data ──────────────────────────────────────────────
async function seedDatingData() {
  console.log("Seeding dating data...");

  const datingUsers: Array<{
    email: string;
    fullName: string;
    gender: Gender;
    dateOfBirth: Date;
    headline: string;
    about: string;
    photos: string[];
    heightCm: number;
    interests: string[];
    lookingFor: LookingFor;
    minAge: number;
    maxAge: number;
    genderPreference: Gender[];
  }> = [
    {
      email: "dating.demo@dagh.app",
      fullName: "Ama Serwaa",
      gender: Gender.FEMALE,
      dateOfBirth: new Date("1994-04-12"),
      headline: "Adventurer & foodie",
      about:
        "Accra-based creative who loves live music, beach walks in Kokrobite and discovering hidden chop bars.",
      photos: ["https://images.unsplash.com/photo-1494790108377-be9c29b29330"],
      heightCm: 168,
      interests: ["Travel", "Music", "Food"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      minAge: 28,
      maxAge: 40,
      genderPreference: [Gender.MALE],
    },
    {
      email: "dating.demo2@dagh.app",
      fullName: "Kwame Boateng",
      gender: Gender.MALE,
      dateOfBirth: new Date("1991-09-23"),
      headline: "Engineer who loves the outdoors",
      about:
        "Kumasi-based engineer. Weekend hikes, football and planning my next trip home to the diaspora.",
      photos: ["https://images.unsplash.com/photo-1500648767791-00dcc994a43e"],
      heightCm: 180,
      interests: ["Hiking", "Football", "Travel"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      minAge: 25,
      maxAge: 38,
      genderPreference: [Gender.FEMALE],
    },
    {
      email: "dating.demo3@dagh.app",
      fullName: "Nana Yaa",
      gender: Gender.FEMALE,
      dateOfBirth: new Date("1997-01-05"),
      headline: "Coffee lover ☕",
      about:
        "Marketing professional. I collect vinyl records, love film photography and my cat is my co-pilot.",
      photos: ["https://images.unsplash.com/photo-1438761681033-6461ffad8d80"],
      heightCm: 165,
      interests: ["Photography", "Music", "Coffee"],
      lookingFor: LookingFor.SHORT_TERM,
      minAge: 26,
      maxAge: 36,
      genderPreference: [Gender.MALE],
    },
  ];

  for (const demo of datingUsers) {
    const existing = await prisma.user.findUnique({ where: { email: demo.email } });
    if (existing) continue;

    const user = await prisma.user.create({
      data: {
        authProvider: "EMAIL",
        email: demo.email,
        accountStatus: "ACTIVE",
        fullName: demo.fullName,
        gender: demo.gender,
        dateOfBirth: demo.dateOfBirth,
      },
    });

    const datingProfile = await prisma.datingProfile.create({
      data: {
        userId: user.id,
        headline: demo.headline,
        about: demo.about,
        photos: demo.photos,
        heightCm: demo.heightCm,
        interests: demo.interests,
        lookingFor: demo.lookingFor,
      },
    });

    await prisma.discoveryPreference.create({
      data: {
        userId: user.id,
        datingProfileId: datingProfile.id,
        lookingFor: demo.lookingFor,
        genderPreference: demo.genderPreference,
        minAge: demo.minAge,
        maxAge: demo.maxAge,
        locationName: demo.gender === Gender.FEMALE ? "Accra" : "Kumasi",
        locationLat: demo.gender === Gender.FEMALE ? 5.6037 : 6.6885,
        locationLng: demo.gender === Gender.FEMALE ? -0.187 : -1.6244,
      },
    });
  }

  console.log("Dating demo data seeded successfully.");
}

async function main() {
  console.log("Seeding tour sites...");
  const siteCount = await prisma.tourSite.count();
  if (siteCount == 0) {
    for (const site of tourSites) {
      await prisma.tourSite.create({ data: site });
    }

    console.log(`Seeded ${tourSites.length} tour sites successfully.`);
  }

  // Seed Ledger Accounts
  await prisma.ledgerAccount.createMany({
    data: [
      {
        name: "Account_DAGh_Revenue",
        currency: "GHS",
      },
      {
        name: "Account_GIS_Statutory_Reserve",
        currency: "GHS",
      },
    ],
    skipDuplicates: true, // prevents errors if already seeded
  });

  console.log("Ledger accounts seeded successfully");

  // Seed Membership Plans
  console.log("Seeding membership plans...");
  const planCount = await prisma.membershipPlan.count();
  if (planCount == 0) {
    const membershipPlans: Prisma.MembershipPlanCreateInput[] = [
      {
        code: "FREE",
        name: "Free",
        description: "Basic access to DAGh platform features",
        price: 0,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "Basic profile listing",
          "Community forum access",
          "Tour listings & exploration",
          "Email support",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "BASELINE",
        name: "Baseline",
        description: "Essential features for active diaspora members",
        price: 150,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All Free features",
          "Enhanced profile with media",
          "Direct messaging",
          "Tour booking discounts (5%)",
          "Priority email support",
        ],
        isMostPopular: true,
        isActive: true,
      },
      {
        code: "SENIOR_PIONEER",
        name: "Senior Pioneer",
        description: "For diaspora seniors aged 60+",
        price: 800,
        currency: "GHS",
        interval: "ANNUAL",
        features: [
          "All Baseline features",
          "Senior-specific tour packages",
          "Companion matching",
          "Health & wellness resources",
          "Tour booking discounts (10%)",
          "Priority phone support",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "SANKOFA_SETTLED",
        name: "'Sankofa' Settled",
        description: "For returnees and settled diaspora members",
        price: 1200,
        currency: "GHS",
        interval: "ANNUAL",
        features: [
          "All Baseline features",
          "Property listing access",
          "Business networking events",
          "Investment opportunity alerts",
          "Tour booking discounts (15%)",
          "Dedicated support line",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "BASIC",
        name: "Basic",
        description: "Starter paid tier with added benefits",
        price: 300,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All Baseline features",
          "Itinerary generation",
          "Visa application assistance",
          "Cultural event invitations",
          "Tour booking discounts (10%)",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "SILVER",
        name: "Silver",
        description: "Premium features for frequent travellers",
        price: 500,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All Basic features",
          "Expedited visa processing",
          "Airport pickup & drop-off",
          "Personalised itinerary planning",
          "Tour booking discounts (15%)",
          "Priority support with 4hr response",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "GOLD_INVESTOR",
        name: "Gold Investor",
        description: "For diaspora investors and high-net-worth members",
        price: 3000,
        currency: "GHS",
        interval: "ANNUAL",
        features: [
          "All Silver features",
          "Investment advisory sessions",
          "Business matching & introductions",
          "Government liaison support",
          "Premium tour packages (20% off)",
          "24/7 dedicated concierge",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "ELITE_AMBASSADOR",
        name: "Elite Ambassador",
        description: "The ultimate membership for diaspora leaders",
        price: 6000,
        currency: "GHS",
        interval: "ANNUAL",
        features: [
          "All Gold Investor features",
          "Ambassador designation & certificate",
          "VIP event access & speaking opportunities",
          "Media & PR opportunities",
          "Complimentary tours (2/year)",
          "White-glove 24/7 concierge",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "FAMILY_PLAN",
        name: "Family Plan",
        description: "Cover your whole family under one plan",
        price: 800,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "Up to 5 family members",
          "All Basic features for each member",
          "Family tour packages",
          "Group booking discounts (20%)",
          "Shared itinerary planning",
          "Family priority support",
        ],
        isMostPopular: false,
        isActive: true,
      },
    ];

    for (const plan of membershipPlans) {
      await prisma.membershipPlan.create({ data: plan });
    }

    console.log(`Seeded ${membershipPlans.length} membership plans successfully.`);
  }

  await seedDatingData();
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
