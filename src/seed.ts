// import { PrismaClient } from "@prisma/client";
// impor

import { prisma } from "./config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { deriveTransitProfile } from "./helpers/transit-profile.js";
import { tourSiteCatalogue } from "./seed-data/tour-catalogue.js";
import { uniqueSiteImages } from "./seed-data/ghana-tour-site-images-unique.js";
import { allowedCountries } from "./seed-data/allowed-countries.js";
import {
  AccountStatus,
  AccountType,
  AdminDepartment,
  AdminRole,
  ApartmentType,
  AuthProvider,
  BookingStatus,
  Ethnicity,
  Gender,
  LookingFor,
  MatchStatus,
  MembershipTierCode,
  MessageType,
  PaymentStatus,
  PaymentTargetType,
  SubscriptionStatus,
  TransportType,
  VisaApprovalStatus,
  VisaPackageType,
  VisaRequestStatus,
} from "../generated/prisma/enums.js";
import * as bcrypt from "bcrypt";
import crypto from "crypto";

// const prisma = new PrismaClient();

const DEMO_PASSWORD = "Demo@12345";
const ADMIN_PASSWORD = "Admin@12345";

// ── Dating module demo data ──────────────────────────────────────────────
// Idempotent: re-running refreshes the demo dating profiles with the values
// below (upserts), so frontend devs can always reset their test data.
async function seedDatingData() {
  console.log("Seeding dating data...");

  const datingUsers: Array<{
    email: string;
    fullName: string;
    gender: Gender;
    dateOfBirth: Date;
    ethnicity: Ethnicity;
    headline: string;
    about: string;
    photos: string[];
    heightCm: number;
    interests: string[];
    lookingFor: LookingFor;
    location: string;
    degree: string;
    university: string;
    profession: string;
    industry: string;
    workLocation: string;
    languages: string[];
    religion: string;
    hometown: string;
    minAge: number;
    maxAge: number;
    genderPreference: Gender[];
  }> = [
    {
      email: "dating.demo@dagh.app",
      fullName: "Ama Serwaa",
      gender: Gender.FEMALE,
      dateOfBirth: new Date("1994-04-12"),
      ethnicity: Ethnicity.African,
      headline: "Adventurer & foodie",
      about:
        "Accra-based creative who loves live music, beach walks in Kokrobite and discovering hidden chop bars.",
      photos: ["https://images.unsplash.com/photo-1494790108377-be9c29b29330"],
      heightCm: 168,
      interests: ["Travel", "Music", "Food"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      location: "Accra, Ghana",
      degree: "BFA Graphic Design",
      university: "Kwame Nkrumah University of Science and Technology (KNUST)",
      profession: "Creative Director",
      industry: "Design & Media",
      workLocation: "Accra",
      languages: ["English", "Twi"],
      religion: "Christianity",
      hometown: "Cape Coast",
      minAge: 28,
      maxAge: 40,
      genderPreference: [Gender.MALE],
    },
    {
      email: "dating.demo2@dagh.app",
      fullName: "Kwame Boateng",
      gender: Gender.MALE,
      dateOfBirth: new Date("1991-09-23"),
      ethnicity: Ethnicity.African,
      headline: "Engineer who loves the outdoors",
      about:
        "Kumasi-based engineer. Weekend hikes, football and planning my next trip home to the diaspora.",
      photos: ["https://images.unsplash.com/photo-1500648767791-00dcc994a43e"],
      heightCm: 180,
      interests: ["Hiking", "Football", "Travel"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      location: "Kumasi, Ghana",
      degree: "MSc Civil Engineering",
      university: "University of Ghana",
      profession: "Structural Engineer",
      industry: "Construction",
      workLocation: "Kumasi",
      languages: ["English", "Twi", "Hausa"],
      religion: "Christianity",
      hometown: "Kumasi",
      minAge: 25,
      maxAge: 38,
      genderPreference: [Gender.FEMALE],
    },
    {
      email: "dating.demo3@dagh.app",
      fullName: "Nana Yaa",
      gender: Gender.FEMALE,
      dateOfBirth: new Date("1997-01-05"),
      ethnicity: Ethnicity.African,
      headline: "Coffee lover ☕",
      about:
        "Marketing professional. I collect vinyl records, love film photography and my cat is my co-pilot.",
      photos: ["https://images.unsplash.com/photo-1438761681033-6461ffad8d80"],
      heightCm: 165,
      interests: ["Photography", "Music", "Coffee"],
      lookingFor: LookingFor.SHORT_TERM,
      location: "Accra, Ghana",
      degree: "BSc Marketing",
      university: "University of Ghana",
      profession: "Brand Manager",
      industry: "Marketing",
      workLocation: "Accra",
      languages: ["English", "Twi", "French"],
      religion: "Christianity",
      hometown: "Accra",
      minAge: 26,
      maxAge: 36,
      genderPreference: [Gender.MALE],
    },
    {
      email: "dating.demo4@dagh.app",
      fullName: "Efua Amoako",
      gender: Gender.FEMALE,
      dateOfBirth: new Date("1995-08-30"),
      ethnicity: Ethnicity.African,
      headline: "Yoga teacher & plant mom",
      about:
        "Cape Coast raised, Accra based. I teach yoga, paint on the weekends and am always up for a beach day.",
      photos: ["https://images.unsplash.com/photo-1517841905240-472988babdf9"],
      heightCm: 163,
      interests: ["Yoga", "Art", "Travel", "Food"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      location: "Accra, Ghana",
      degree: "BSc Physiotherapy",
      university: "University of Cape Coast",
      profession: "Yoga Instructor",
      industry: "Health & Wellness",
      workLocation: "Accra",
      languages: ["English", "Fante"],
      religion: "Christianity",
      hometown: "Cape Coast",
      minAge: 26,
      maxAge: 40,
      genderPreference: [Gender.MALE],
    },
    {
      email: "dating.demo5@dagh.app",
      fullName: "Kojo Asante",
      gender: Gender.MALE,
      dateOfBirth: new Date("1989-11-11"),
      ethnicity: Ethnicity.African,
      headline: "Chef & food blogger",
      about:
        "I run a small kitchen in Osu. If you love good jollof, travel stories and vinyl nights, we'll get along.",
      photos: ["https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d"],
      heightCm: 182,
      interests: ["Food", "Travel", "Music", "Football"],
      lookingFor: LookingFor.LONG_TERM_PARTNER,
      location: "Accra, Ghana",
      degree: "Diploma in Culinary Arts",
      university: "Accra Technical University",
      profession: "Chef",
      industry: "Hospitality",
      workLocation: "Accra",
      languages: ["English", "Ga", "Twi"],
      religion: "Christianity",
      hometown: "Takoradi",
      minAge: 25,
      maxAge: 38,
      genderPreference: [Gender.FEMALE],
    },
  ];

  for (const demo of datingUsers) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {
        accountStatus: AccountStatus.ACTIVE,
        fullName: demo.fullName,
        gender: demo.gender,
        dateOfBirth: demo.dateOfBirth,
        ethnicity: demo.ethnicity,
        passwordHash,
      },
      create: {
        authProvider: AuthProvider.PASSWORD,
        email: demo.email,
        passwordHash,
        accountStatus: AccountStatus.ACTIVE,
        fullName: demo.fullName,
        gender: demo.gender,
        dateOfBirth: demo.dateOfBirth,
        ethnicity: demo.ethnicity,
        phoneNumber:
          demo.email === "dating.demo@dagh.app"
            ? "+233241000001"
            : demo.email === "dating.demo2@dagh.app"
              ? "+233241000002"
              : demo.email === "dating.demo3@dagh.app"
                ? "+233241000003"
                : demo.email === "dating.demo4@dagh.app"
                  ? "+233241000004"
                  : "+233241000005",
      },
    });

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    const datingProfile = await prisma.datingProfile.upsert({
      where: { userId: user.id },
      update: {
        headline: demo.headline,
        about: demo.about,
        photos: demo.photos,
        heightCm: demo.heightCm,
        interests: demo.interests,
        lookingFor: demo.lookingFor,
        location: demo.location,
        degree: demo.degree,
        university: demo.university,
        profession: demo.profession,
        industry: demo.industry,
        workLocation: demo.workLocation,
        languages: demo.languages,
        religion: demo.religion,
        hometown: demo.hometown,
      },
      create: {
        userId: user.id,
        headline: demo.headline,
        about: demo.about,
        photos: demo.photos,
        heightCm: demo.heightCm,
        interests: demo.interests,
        lookingFor: demo.lookingFor,
        location: demo.location,
        degree: demo.degree,
        university: demo.university,
        profession: demo.profession,
        industry: demo.industry,
        workLocation: demo.workLocation,
        languages: demo.languages,
        religion: demo.religion,
        hometown: demo.hometown,
      },
    });

    await prisma.discoveryPreference.upsert({
      where: { userId: user.id },
      update: {
        lookingFor: demo.lookingFor,
        genderPreference: demo.genderPreference,
        minAge: demo.minAge,
        maxAge: demo.maxAge,
        locationName: demo.location,
      },
      create: {
        userId: user.id,
        datingProfileId: datingProfile.id,
        lookingFor: demo.lookingFor,
        genderPreference: demo.genderPreference,
        minAge: demo.minAge,
        maxAge: demo.maxAge,
        locationName: demo.location,
      },
    });
  }

  console.log("Dating demo data seeded successfully.");
}

// ── Demo accounts for frontend developers ────────────────────────────────
// All demo users share the password `Demo@12345`; the admin uses `Admin@12345`.
async function seedDemoUsers() {
  console.log("Seeding demo user accounts...");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const demoUsers = [
    {
      email: "admin@dagh.app",
      fullName: "System Administrator",
      accountType: AccountType.ADMIN,
      phoneNumber: "+233240000001",
      hash: adminHash,
    },
    {
      email: "demo@dagh.app",
      fullName: "Kofi Mensah",
      accountType: AccountType.USER,
      phoneNumber: "+233240000002",
      hash: passwordHash,
    },
    {
      email: "demotwo@dagh.app",
      fullName: "Abena Owusu",
      accountType: AccountType.USER,
      phoneNumber: "+233240000003",
      hash: passwordHash,
    },
  ];

  for (const demo of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: demo.hash,
        accountType: demo.accountType,
        fullName: demo.fullName,
        gender: demo.email === "demo@dagh.app" ? Gender.MALE : Gender.FEMALE,
        dateOfBirth: new Date("1993-06-18"),
        phoneNumber: demo.phoneNumber,
        ethnicity: Ethnicity.Black_African_American,
      },
      create: {
        authProvider: AuthProvider.PASSWORD,
        email: demo.email,
        passwordHash: demo.hash,
        accountStatus: AccountStatus.ACTIVE,
        accountType: demo.accountType,
        fullName: demo.fullName,
        gender: demo.email === "demo@dagh.app" ? Gender.MALE : Gender.FEMALE,
        dateOfBirth: new Date("1993-06-18"),
        phoneNumber: demo.phoneNumber,
        ethnicity: Ethnicity.Black_African_American,
      },
    });

    const profileExists = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profileExists) {
      await prisma.userProfile.create({
        data: { userId: user.id },
      });
    }

    if (demo.email === "admin@dagh.app") {
      const adminProfileExists = await prisma.adminProfile.findUnique({
        where: { userId: user.id },
      });
      if (!adminProfileExists) {
        await prisma.adminProfile.create({
          data: {
            userId: user.id,
            department: AdminDepartment.OPERATIONS_AND_MEMBERSHIP,
            role: AdminRole.SUPER_ADMIN,
          },
        });
      }
    }

    if (demo.email === "demo@dagh.app") {
      const dp = await prisma.datingProfile.upsert({
        where: { userId: user.id },
        update: {
          headline: "Software Engineer from Accra",
          about: "Diaspora Ghanaian back home to build, connect and travel. Always up for a hike.",
          photos: ["https://images.unsplash.com/photo-1522529599102-193c0d76b5b6"],
          heightCm: 175,
          interests: ["Tech", "Music", "Travel"],
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          location: "Accra, Ghana",
          degree: "BSc Computer Science",
          university: "University of Ghana",
          profession: "Software Engineer",
          industry: "Technology",
          workLocation: "Accra",
          languages: ["English", "Twi"],
          religion: "Christianity",
          hometown: "Kumasi",
        },
        create: {
          userId: user.id,
          headline: "Software Engineer from Accra",
          about: "Diaspora Ghanaian back home to build, connect and travel. Always up for a hike.",
          photos: ["https://images.unsplash.com/photo-1522529599102-193c0d76b5b6"],
          heightCm: 175,
          interests: ["Tech", "Music", "Travel"],
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          location: "Accra, Ghana",
          degree: "BSc Computer Science",
          university: "University of Ghana",
          profession: "Software Engineer",
          industry: "Technology",
          workLocation: "Accra",
          languages: ["English", "Twi"],
          religion: "Christianity",
          hometown: "Kumasi",
        },
      });
      await prisma.discoveryPreference.upsert({
        where: { userId: user.id },
        update: {
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          genderPreference: [Gender.FEMALE],
          minAge: 22,
          maxAge: 35,
          locationName: "Accra",
          locationLat: 5.6037,
          locationLng: -0.187,
        },
        create: {
          userId: user.id,
          datingProfileId: dp.id,
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          genderPreference: [Gender.FEMALE],
          minAge: 22,
          maxAge: 35,
          locationName: "Accra",
          locationLat: 5.6037,
          locationLng: -0.187,
        },
      });
    }

    if (demo.email === "demotwo@dagh.app") {
      const dp = await prisma.datingProfile.upsert({
        where: { userId: user.id },
        update: {
          headline: "Traveller & bookworm",
          about:
            "I read a lot and plan my next trip home. Looking for deep conversations and good company.",
          photos: ["https://images.unsplash.com/photo-1524504388940-b1c1722653e1"],
          heightCm: 166,
          interests: ["Books", "Travel", "Photography"],
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          location: "Accra, Ghana",
          degree: "MBA",
          university: "University of Ghana Business School",
          profession: "Product Manager",
          industry: "Technology",
          workLocation: "Remote",
          languages: ["English", "Twi"],
          religion: "Christianity",
          hometown: "Kumasi",
        },
        create: {
          userId: user.id,
          headline: "Traveller & bookworm",
          about:
            "I read a lot and plan my next trip home. Looking for deep conversations and good company.",
          photos: ["https://images.unsplash.com/photo-1524504388940-b1c1722653e1"],
          heightCm: 166,
          interests: ["Books", "Travel", "Photography"],
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          location: "Accra, Ghana",
          degree: "MBA",
          university: "University of Ghana Business School",
          profession: "Product Manager",
          industry: "Technology",
          workLocation: "Remote",
          languages: ["English", "Twi"],
          religion: "Christianity",
          hometown: "Kumasi",
        },
      });
      await prisma.discoveryPreference.upsert({
        where: { userId: user.id },
        update: {
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          genderPreference: [Gender.MALE],
          minAge: 25,
          maxAge: 38,
          locationName: "Accra",
          locationLat: 5.6037,
          locationLng: -0.187,
        },
        create: {
          userId: user.id,
          datingProfileId: dp.id,
          lookingFor: LookingFor.LONG_TERM_PARTNER,
          genderPreference: [Gender.MALE],
          minAge: 25,
          maxAge: 38,
          locationName: "Accra",
          locationLat: 5.6037,
          locationLng: -0.187,
        },
      });
    }
  }

  // Give the primary demo user an active paid subscription so membership
  // endpoints return richer data.
  const demoUser = await prisma.user.findUniqueOrThrow({ where: { email: "demo@dagh.app" } });
  const baselinePlan = await prisma.membershipPlan.findFirst({ where: { code: "BASELINE" } });
  const subExists = await prisma.userSubscription.findUnique({ where: { userId: demoUser.id } });
  if (!subExists && baselinePlan) {
    await prisma.userSubscription.create({
      data: {
        userId: demoUser.id,
        planId: baselinePlan.id,
        tierCode: MembershipTierCode.BASELINE,
        memberCode: "89345-BSL",
        autoRenew: true,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log("Demo user accounts seeded successfully.");
}

// ── Sample tour packages ──────────────────────────────────────────────────
async function seedTours() {
  console.log("Seeding tour packages...");

  const existing = await prisma.tour_packages.count();
  if (existing > 0) {
    console.log(`${existing} tour packages already exist — skipping tour seeding.`);
    return;
  }

  const tours: Array<{
    title: string;
    slug: string;
    category: string;
    subcategory: string;
    durationDays: number;
    durationNights: number;
    basePrice: number;
    coverImage: string;
    featured: boolean;
    trending: boolean;
    shortDescription: string;
    description: string;
    locations: Array<{
      name: string;
      city: string;
      region: string;
      description: string;
      visitDuration: number;
    }>;
    itinerary: Array<{
      dayNumber: number;
      title: string;
      description: string;
      breakfast: boolean;
      lunch: boolean;
      dinner: boolean;
      accommodationName: string;
      accommodationType: string;
      activities: Array<{
        activityTime: string;
        activity: string;
        durationMinutes: number;
        included: boolean;
        locationName: string;
      }>;
    }>;
    includes: string[];
    excludes: string[];
  }> = [
    {
      title: "Coastal Heritage Discovery",
      slug: "coastal-heritage-discovery",
      category: "heritage",
      subcategory: "historical",
      durationDays: 3,
      durationNights: 2,
      basePrice: 2400,
      coverImage: "https://images.unsplash.com/photo-1560882344-826acd27c2b2",
      featured: true,
      trending: true,
      shortDescription: "Trace Ghana's history from Accra to Cape Coast and Elmina.",
      description:
        "A 3-day journey through Ghana's slave castles, coastal forts and the vibrant culture of the Central Region, including visits to the Kwame Nkrumah Mausoleum, Cape Coast Castle and Elmina Castle.",
      locations: [
        {
          name: "Kwame Nkrumah Mausoleum",
          city: "Accra",
          region: "Greater Accra",
          description: "Museum and mausoleum honouring Ghana's first president.",
          visitDuration: 90,
        },
        {
          name: "Cape Coast Castle",
          city: "Cape Coast",
          region: "Central",
          description: "UNESCO World Heritage slave castle.",
          visitDuration: 150,
        },
        {
          name: "Elmina Castle",
          city: "Elmina",
          region: "Central",
          description: "Oldest European building in sub-Saharan Africa.",
          visitDuration: 120,
        },
        {
          name: "Kakum National Park",
          city: "Kakum",
          region: "Central",
          description: "Canopy walkway over the rainforest.",
          visitDuration: 120,
        },
      ],
      itinerary: [
        {
          dayNumber: 1,
          title: "Arrival & Accra Highlights",
          description:
            "City tour of Accra with visits to the Kwame Nkrumah Mausoleum and Independence Arch.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Labadi Beach Hotel",
          accommodationType: "HOTEL",
          activities: [
            {
              activityTime: "09:00",
              activity: "Kwame Nkrumah Mausoleum guided tour",
              durationMinutes: 90,
              included: true,
              locationName: "Accra",
            },
            {
              activityTime: "12:30",
              activity: "Lunch at a local chop bar",
              durationMinutes: 60,
              included: true,
              locationName: "Accra",
            },
            {
              activityTime: "15:00",
              activity: "Independence Square & Black Star Gate",
              durationMinutes: 60,
              included: true,
              locationName: "Accra",
            },
          ],
        },
        {
          dayNumber: 2,
          title: "Cape Coast & Elmina Castles",
          description: "Full day exploring the Cape Coast and Elmina slave castles.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Cape Coast Castle Hotel",
          accommodationType: "GUESTHOUSE",
          activities: [
            {
              activityTime: "08:30",
              activity: "Cape Coast Castle tour",
              durationMinutes: 150,
              included: true,
              locationName: "Cape Coast",
            },
            {
              activityTime: "12:00",
              activity: "Lunch overlooking the Atlantic",
              durationMinutes: 60,
              included: true,
              locationName: "Cape Coast",
            },
            {
              activityTime: "14:30",
              activity: "Elmina Castle & fishing village",
              durationMinutes: 120,
              included: true,
              locationName: "Elmina",
            },
          ],
        },
        {
          dayNumber: 3,
          title: "Kakum Canopy Walkway",
          description: "Canopy walkway adventure and return to Accra.",
          breakfast: true,
          lunch: true,
          dinner: false,
          accommodationName: "",
          accommodationType: "",
          activities: [
            {
              activityTime: "07:30",
              activity: "Kakum canopy walkway",
              durationMinutes: 120,
              included: true,
              locationName: "Kakum",
            },
            {
              activityTime: "12:00",
              activity: "Lunch at Kakum visitor centre",
              durationMinutes: 60,
              included: true,
              locationName: "Kakum",
            },
            {
              activityTime: "14:00",
              activity: "Departure back to Accra",
              durationMinutes: 180,
              included: false,
              locationName: "Accra",
            },
          ],
        },
      ],
      includes: [
        "All hotel accommodation",
        "Daily breakfast, lunch and dinner",
        "Air-conditioned transport",
        "Professional tour guide",
        "All entrance fees",
        "Bottled water",
      ],
      excludes: ["International flights", "Travel insurance", "Personal expenses", "Gratuities"],
    },
    {
      title: "Ashanti Kingdom & Culture",
      slug: "ashanti-kingdom-culture",
      category: "cultural",
      subcategory: "heritage",
      durationDays: 2,
      durationNights: 1,
      basePrice: 1600,
      coverImage: "https://images.unsplash.com/photo-1580654712603-eb43273aff33",
      featured: true,
      trending: false,
      shortDescription: "Explore the Ashanti capital, royal history and vibrant markets.",
      description:
        "Discover the seat of the Ashanti Kingdom with visits to the Manhyia Palace Museum, Kejetia Market and the sacred Lake Bosomtwe.",
      locations: [
        {
          name: "Manhyia Palace Museum",
          city: "Kumasi",
          region: "Ashanti",
          description: "Official seat of the Asantehene.",
          visitDuration: 90,
        },
        {
          name: "Kejetia Market",
          city: "Kumasi",
          region: "Ashanti",
          description: "One of the largest open-air markets in West Africa.",
          visitDuration: 120,
        },
        {
          name: "Lake Bosomtwe",
          city: "Bosomtwe",
          region: "Ashanti",
          description: "Ghana's only natural crater lake.",
          visitDuration: 90,
        },
      ],
      itinerary: [
        {
          dayNumber: 1,
          title: "Kumasi Royal Tour",
          description: "Manhyia Palace and the vibrant Kejetia Market.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Golden Tulip Kumasi",
          accommodationType: "HOTEL",
          activities: [
            {
              activityTime: "09:30",
              activity: "Manhyia Palace Museum",
              durationMinutes: 90,
              included: true,
              locationName: "Kumasi",
            },
            {
              activityTime: "12:00",
              activity: "Kejetia Market & kente shopping",
              durationMinutes: 120,
              included: true,
              locationName: "Kumasi",
            },
            {
              activityTime: "16:00",
              activity: "Cultural drumming and dance performance",
              durationMinutes: 60,
              included: true,
              locationName: "Kumasi",
            },
          ],
        },
        {
          dayNumber: 2,
          title: "Lake Bosomtwe",
          description: "Sacred lake and scenic drive back to Accra.",
          breakfast: true,
          lunch: true,
          dinner: false,
          accommodationName: "",
          accommodationType: "",
          activities: [
            {
              activityTime: "08:00",
              activity: "Lake Bosomtwe boat ride",
              durationMinutes: 90,
              included: true,
              locationName: "Lake Bosomtwe",
            },
            {
              activityTime: "12:00",
              activity: "Lunch at lakeside village",
              durationMinutes: 60,
              included: true,
              locationName: "Lake Bosomtwe",
            },
            {
              activityTime: "14:00",
              activity: "Return transfer to Accra",
              durationMinutes: 240,
              included: false,
              locationName: "Accra",
            },
          ],
        },
      ],
      includes: [
        "Hotel accommodation",
        "Breakfast, lunch and dinner",
        "Transport",
        "Guided tours",
        "Entrance fees",
      ],
      excludes: ["Personal expenses", "Gratuities", "Travel insurance"],
    },
    {
      title: "Volta Waterfalls & Nature",
      slug: "volta-waterfalls-nature",
      category: "nature",
      subcategory: "adventure",
      durationDays: 2,
      durationNights: 1,
      basePrice: 1400,
      coverImage: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
      featured: false,
      trending: false,
      shortDescription: "Waterfalls, monkeys and the highest peak in Ghana.",
      description:
        "A nature escape to the Volta Region featuring Wli Waterfalls, the Tafi Atome Monkey Sanctuary and Mount Afadjato.",
      locations: [
        {
          name: "Wli Waterfalls",
          city: "Hohoe",
          region: "Volta",
          description: "The highest waterfall in West Africa.",
          visitDuration: 120,
        },
        {
          name: "Tafi Atome Monkey Sanctuary",
          city: "Tafi Atome",
          region: "Volta",
          description: "Community-run Mona monkey sanctuary.",
          visitDuration: 90,
        },
        {
          name: "Mount Afadjato",
          city: "Gbledi",
          region: "Volta",
          description: "Ghana's highest peak.",
          visitDuration: 150,
        },
      ],
      itinerary: [
        {
          dayNumber: 1,
          title: "Wli Waterfalls",
          description: "Hike to the base of West Africa's tallest waterfall.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Wli Nature Lodge",
          accommodationType: "GUESTHOUSE",
          activities: [
            {
              activityTime: "07:30",
              activity: "Transfer from Accra to Hohoe",
              durationMinutes: 240,
              included: false,
              locationName: "Volta",
            },
            {
              activityTime: "14:00",
              activity: "Wli Waterfalls hike",
              durationMinutes: 120,
              included: true,
              locationName: "Wli",
            },
            {
              activityTime: "18:00",
              activity: "Bonfire night at the lodge",
              durationMinutes: 90,
              included: true,
              locationName: "Wli",
            },
          ],
        },
        {
          dayNumber: 2,
          title: "Monkeys & Mount Afadjato",
          description: "Feed Mona monkeys and climb Ghana's highest peak.",
          breakfast: true,
          lunch: true,
          dinner: false,
          accommodationName: "",
          accommodationType: "",
          activities: [
            {
              activityTime: "08:00",
              activity: "Tafi Atome Monkey Sanctuary",
              durationMinutes: 90,
              included: true,
              locationName: "Tafi Atome",
            },
            {
              activityTime: "10:30",
              activity: "Mount Afadjato summit hike",
              durationMinutes: 150,
              included: true,
              locationName: "Afadjato",
            },
            {
              activityTime: "14:00",
              activity: "Return transfer to Accra",
              durationMinutes: 240,
              included: false,
              locationName: "Accra",
            },
          ],
        },
      ],
      includes: [
        "Lodge accommodation",
        "Meals as listed",
        "Transport",
        "Local guides",
        "Entrance fees",
      ],
      excludes: ["Hiking boots", "Personal expenses", "Travel insurance"],
    },
    {
      title: "Northern Safari Adventure",
      slug: "northern-safari-adventure",
      category: "wildlife",
      subcategory: "safari",
      durationDays: 4,
      durationNights: 3,
      basePrice: 3200,
      coverImage: "https://images.unsplash.com/photo-1547471080-7cc2caa01a7e",
      featured: false,
      trending: true,
      shortDescription: "Elephants, the Larabanga mosque and the savannah north.",
      description:
        "A 4-day safari through Mole National Park with elephant sightings, the historic Larabanga Mosque and Paga's sacred crocodile pond.",
      locations: [
        {
          name: "Mole National Park",
          city: "Damongo",
          region: "Savannah",
          description: "Ghana's largest wildlife refuge.",
          visitDuration: 180,
        },
        {
          name: "Larabanga Mosque",
          city: "Larabanga",
          region: "Savannah",
          description: "One of the oldest mosques in West Africa.",
          visitDuration: 60,
        },
        {
          name: "Paga Crocodile Pond",
          city: "Paga",
          region: "Upper East",
          description: "Sacred pond of tame crocodiles.",
          visitDuration: 90,
        },
      ],
      itinerary: [
        {
          dayNumber: 1,
          title: "Journey North",
          description: "Scenic drive through the savannah to Mole National Park.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Mole Motel",
          accommodationType: "HOTEL",
          activities: [
            {
              activityTime: "07:00",
              activity: "Depart Accra for Damongo",
              durationMinutes: 480,
              included: false,
              locationName: "Northern",
            },
            {
              activityTime: "18:00",
              activity: "Sunset view over Mole escarpment",
              durationMinutes: 60,
              included: true,
              locationName: "Mole",
            },
          ],
        },
        {
          dayNumber: 2,
          title: "Elephant Safari",
          description: "Early morning and late afternoon game drives.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Mole Motel",
          accommodationType: "HOTEL",
          activities: [
            {
              activityTime: "06:30",
              activity: "Morning game drive",
              durationMinutes: 180,
              included: true,
              locationName: "Mole National Park",
            },
            {
              activityTime: "15:00",
              activity: "Elephant tracking on foot",
              durationMinutes: 120,
              included: true,
              locationName: "Mole National Park",
            },
          ],
        },
        {
          dayNumber: 3,
          title: "Larabanga & Paga",
          description: "Historic mosque and sacred crocodiles.",
          breakfast: true,
          lunch: true,
          dinner: true,
          accommodationName: "Paga Guest House",
          accommodationType: "GUESTHOUSE",
          activities: [
            {
              activityTime: "09:00",
              activity: "Larabanga Mosque visit",
              durationMinutes: 60,
              included: true,
              locationName: "Larabanga",
            },
            {
              activityTime: "13:00",
              activity: "Paga Crocodile Pond",
              durationMinutes: 90,
              included: true,
              locationName: "Paga",
            },
          ],
        },
        {
          dayNumber: 4,
          title: "Return South",
          description: "Journey back to Accra.",
          breakfast: true,
          lunch: true,
          dinner: false,
          accommodationName: "",
          accommodationType: "",
          activities: [
            {
              activityTime: "07:00",
              activity: "Depart Paga for Accra",
              durationMinutes: 600,
              included: false,
              locationName: "Northern",
            },
          ],
        },
      ],
      includes: [
        "3 nights accommodation",
        "All meals",
        "Game drives",
        "Park entrance fees",
        "Transport",
        "Local guides",
      ],
      excludes: ["International flights", "Travel insurance", "Personal expenses", "Gratuities"],
    },
  ];

  for (const tour of tours) {
    await prisma.tour_packages.create({
      data: {
        title: tour.title,
        slug: tour.slug,
        category: tour.category,
        subcategory: tour.subcategory,
        durationDays: tour.durationDays,
        durationNights: tour.durationNights,
        basePrice: tour.basePrice,
        currency: "GHS",
        status: "published",
        featured: tour.featured,
        trending: tour.trending,
        shortDescription: tour.shortDescription,
        description: tour.description,
        coverImage: tour.coverImage,
        overallRating: 4.7,
        ratingCount: 24,
        viewCount: 312,
        bookingCount: 8,
        tour_locations: {
          create: tour.locations.map((l) => ({
            id: crypto.randomUUID(),
            name: l.name,
            city: l.city,
            region: l.region,
            description: l.description,
            visitDuration: l.visitDuration,
            photos: [tour.coverImage],
          })),
        },
        tour_media: {
          create: [
            { id: crypto.randomUUID(), media_type: "image", url: tour.coverImage },
            { id: crypto.randomUUID(), media_type: "image", url: tour.coverImage },
          ],
        },
        pricing_includes: {
          create: tour.includes.map((item) => ({ id: crypto.randomUUID(), item })),
        },
        pricing_excludes: {
          create: tour.excludes.map((item) => ({ id: crypto.randomUUID(), item })),
        },
        tour_itineraries: {
          create: tour.itinerary.map((day) => ({
            dayNumber: day.dayNumber,
            title: day.title,
            description: day.description,
            breakfast: day.breakfast,
            lunch: day.lunch,
            dinner: day.dinner,
            accommodationName: day.accommodationName || null,
            accommodationType: day.accommodationType || null,
            itinerary_activities: {
              create: day.activities.map((a) => ({
                id: crypto.randomUUID(),
                activityTime: a.activityTime,
                activity: a.activity,
                durationMinutes: a.durationMinutes,
                included: a.included,
                locationName: a.locationName,
              })),
            },
          })),
        },
      },
    });
  }

  console.log(`Seeded ${tours.length} tour packages successfully.`);
}

// ── Tour bookings for the demo user ───────────────────────────────────────
async function seedTourBookings() {
  console.log("Seeding tour bookings...");

  const demoUser = await prisma.user.findUnique({ where: { email: "demo@dagh.app" } });
  const tour = await prisma.tour_packages.findFirst({
    where: { slug: "coastal-heritage-discovery" },
  });
  if (!demoUser || !tour) return;

  const bookings = [
    {
      bookingReference: "DAGH-BOOK-CONFIRMED-001",
      numberOfPeople: 2,
      totalPrice: 4800,
      status: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.SUCCESS,
      tourStartDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      specialRequests: "Vegetarian meals please.",
    },
    {
      bookingReference: "DAGH-BOOK-PENDING-001",
      numberOfPeople: 1,
      totalPrice: 2400,
      status: BookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      tourStartDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const booking of bookings) {
    await prisma.tour_bookings.upsert({
      where: { bookingReference: booking.bookingReference },
      update: {},
      create: {
        userId: demoUser.id,
        tourId: tour.id,
        bookingReference: booking.bookingReference,
        numberOfPeople: booking.numberOfPeople,
        totalPrice: booking.totalPrice,
        currency: "GHS",
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        tourStartDate: booking.tourStartDate,
        specialRequests: booking.specialRequests,
        contactName: demoUser.fullName,
        contactEmail: demoUser.email,
        contactPhone: demoUser.phoneNumber,
        systemGenerated: false,
      },
    });
  }

  console.log(`Seeded ${bookings.length} tour bookings.`);
}

// ── Dating interactions: swipes, matches, conversations, messages ─────────
async function seedDatingInteractions() {
  console.log("Seeding dating interactions...");

  const getByEmail = async (email: string) => prisma.user.findUnique({ where: { email } });
  const ama = await getByEmail("dating.demo@dagh.app");
  const kwame = await getByEmail("dating.demo2@dagh.app");
  const nana = await getByEmail("dating.demo3@dagh.app");
  const efua = await getByEmail("dating.demo4@dagh.app");
  const kojo = await getByEmail("dating.demo5@dagh.app");
  const demoKofi = await getByEmail("demo@dagh.app");
  const abena = await getByEmail("demotwo@dagh.app");
  if (!ama || !kwame || !nana || !efua || !kojo || !demoKofi || !abena) {
    console.log("Dating demo users missing — skipping interactions.");
    return;
  }

  // Swipes (skip if already present)
  const swipes = [
    { swiperId: ama.id, targetId: kwame.id, direction: "LIKE" as const },
    { swiperId: kwame.id, targetId: ama.id, direction: "LIKE" as const },
    { swiperId: ama.id, targetId: nana.id, direction: "LIKE" as const },
    { swiperId: nana.id, targetId: ama.id, direction: "LIKE" as const },
    { swiperId: kwame.id, targetId: nana.id, direction: "PASS" as const },
    { swiperId: ama.id, targetId: demoKofi.id, direction: "LIKE" as const },
    { swiperId: demoKofi.id, targetId: ama.id, direction: "LIKE" as const },
    { swiperId: nana.id, targetId: demoKofi.id, direction: "LIKE" as const },
    { swiperId: demoKofi.id, targetId: nana.id, direction: "LIKE" as const },
    { swiperId: kojo.id, targetId: kwame.id, direction: "PASS" as const },
    { swiperId: kojo.id, targetId: ama.id, direction: "SUPER_LIKE" as const },
    { swiperId: ama.id, targetId: kojo.id, direction: "LIKE" as const },
    { swiperId: kwame.id, targetId: efua.id, direction: "LIKE" as const },
    { swiperId: efua.id, targetId: kwame.id, direction: "LIKE" as const },
    { swiperId: efua.id, targetId: demoKofi.id, direction: "LIKE" as const },
    { swiperId: kojo.id, targetId: nana.id, direction: "LIKE" as const },
    { swiperId: abena.id, targetId: demoKofi.id, direction: "LIKE" as const },
    { swiperId: demoKofi.id, targetId: abena.id, direction: "LIKE" as const },
  ];
  for (const s of swipes) {
    await prisma.userSwipe.upsert({
      where: { swiperId_targetId: { swiperId: s.swiperId, targetId: s.targetId } },
      update: {},
      create: s,
    });
  }

  // Matches
  const matches = [
    { userId: ama.id, matchedId: kwame.id },
    { userId: kwame.id, matchedId: ama.id },
    { userId: ama.id, matchedId: nana.id },
    { userId: nana.id, matchedId: ama.id },
    { userId: ama.id, matchedId: demoKofi.id },
    { userId: demoKofi.id, matchedId: ama.id },
    { userId: nana.id, matchedId: demoKofi.id },
    { userId: demoKofi.id, matchedId: nana.id },
    { userId: ama.id, matchedId: kojo.id },
    { userId: kojo.id, matchedId: ama.id },
    { userId: kwame.id, matchedId: efua.id },
    { userId: efua.id, matchedId: kwame.id },
    { userId: demoKofi.id, matchedId: abena.id },
    { userId: abena.id, matchedId: demoKofi.id },
  ];
  for (const m of matches) {
    await prisma.userMatch.upsert({
      where: { userId_matchedId: { userId: m.userId, matchedId: m.matchedId } },
      update: { status: MatchStatus.MATCHED },
      create: { ...m, status: MatchStatus.MATCHED },
    });
  }

  // Conversations + messages
  const chats: Array<{
    a: typeof ama;
    b: typeof kwame;
    messages: Array<{ sender: typeof ama; content: string; minutesAgo: number }>;
  }> = [
    {
      a: demoKofi,
      b: ama,
      messages: [
        {
          sender: ama,
          content: "Hey Kofi! Nice to match with you. How's the coding going?",
          minutesAgo: 120,
        },
        {
          sender: demoKofi,
          content: "Hi Ama! Thanks, it's going great. Just finishing up some features.",
          minutesAgo: 110,
        },
      ],
    },
    {
      a: ama,
      b: kwame,
      messages: [
        {
          sender: kwame,
          content: "Hey Ama! I saw we matched. How's your week going?",
          minutesAgo: 320,
        },
        {
          sender: ama,
          content: "Hi Kwame! It's been great, just got back from a hike at Aburi. You?",
          minutesAgo: 310,
        },
        {
          sender: kwame,
          content: "Nice! I'm planning a trip to Mole National Park next month. Love the outdoors.",
          minutesAgo: 300,
        },
        {
          sender: ama,
          content: "That sounds amazing! I've always wanted to see the elephants there.",
          minutesAgo: 290,
        },
      ],
    },
    {
      a: ama,
      b: nana,
      messages: [
        { sender: nana, content: "Coffee sometime? I know a great spot in Osu.", minutesAgo: 60 },
        { sender: ama, content: "Absolutely, I'm free this weekend!", minutesAgo: 45 },
      ],
    },
    {
      a: kojo,
      b: ama,
      messages: [
        {
          sender: kojo,
          content:
            "Hey Ama! Heard you're into live music — ever catch a show at the Alliance Française?",
          minutesAgo: 200,
        },
        {
          sender: ama,
          content: "Hi Kojo! Yes, the jazz nights there are great. You're a chef, right?",
          minutesAgo: 180,
        },
        {
          sender: kojo,
          content: "That's me. I'll cook you my best jollof if you bring the playlist.",
          minutesAgo: 160,
        },
      ],
    },
    {
      a: kwame,
      b: efua,
      messages: [
        {
          sender: efua,
          content:
            "Hi Kwame! A fellow outdoor person — love it. I teach yoga by the beach on Saturdays.",
          minutesAgo: 90,
        },
        {
          sender: kwame,
          content: "Hi Efua! Yoga sounds like the perfect pre-hike warm-up. We should plan one.",
          minutesAgo: 75,
        },
      ],
    },
    {
      a: demoKofi,
      b: abena,
      messages: [
        {
          sender: abena,
          content: "Hey Kofi! Glad we matched. How's the new project coming along?",
          minutesAgo: 50,
        },
        {
          sender: demoKofi,
          content: "Hey Abena! It's going well, thanks. Coffee to celebrate sometime?",
          minutesAgo: 35,
        },
      ],
    },
  ];

  for (const chat of chats) {
    const participantIds = [chat.a.id, chat.b.id];
    const lastMsg = chat.messages[chat.messages.length - 1];
    const existingConversation = await prisma.conversation.findFirst({
      where: { participants: { hasEvery: participantIds } },
      orderBy: { createdAt: "desc" },
    });
    const conversation =
      existingConversation ??
      (await prisma.conversation.create({
        data: {
          participants: participantIds,
          lastMessage: lastMsg.content,
          lastMessageAt: new Date(Date.now() - lastMsg.minutesAgo * 60 * 1000),
        },
      }));

    for (const msg of chat.messages) {
      const exists = await prisma.message.findFirst({
        where: { conversationId: conversation.id, senderId: msg.sender.id, content: msg.content },
      });
      if (exists) continue;
      const receiverId = participantIds.find((p) => p !== msg.sender.id)!;
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: msg.sender.id,
          receiverId,
          type: MessageType.TEXT,
          content: msg.content,
          isRead: true,
          readAt: new Date(),
          createdAt: new Date(Date.now() - msg.minutesAgo * 60 * 1000),
        },
      });
    }
  }

  console.log("Dating interactions seeded successfully.");
}

// ── Visa-on-arrival request for the demo user ─────────────────────────────
async function seedVisaRequests() {
  console.log("Seeding visa requests...");

  const demoUser = await prisma.user.findUnique({ where: { email: "demo@dagh.app" } });
  if (!demoUser) return;

  const existing = await prisma.visaOnArrivalRequest.findFirst({
    where: { userId: demoUser.id },
  });
  if (existing) return;

  await prisma.visaOnArrivalRequest.create({
    data: {
      userId: demoUser.id,
      status: VisaRequestStatus.PENDING,
      packageType: VisaPackageType.STANDARD,
      visaData: {
        create: {
          passport_image_url: "https://images.unsplash.com/photo-1627123424574-724758594e93",
          bio_page_image_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
          flight_itinerary_image_url:
            "https://images.unsplash.com/photo-1436491865332-7a61a109cc05",
          passport_number: "G000123456",
          purpose_of_trip: "Tourism",
          date_of_departure: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
          date_of_arrival: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });

  console.log("Visa request seeded successfully.");
}

// ── Admin console demo data ────────────────────────────────────────────────
// Creates a spread of visa requests (queued / approved / rejected / failed),
// linked payments, and admin activity logs so the console KPI cards and tables
// are non-empty after a fresh seed. Idempotent: keyed off passport numbers.
async function seedAdminConsoleData() {
  console.log("Seeding admin console data...");

  const demoUser = await prisma.user.findUnique({ where: { email: "demo@dagh.app" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@dagh.app" } });
  if (!demoUser || !admin) return;

  const visaSeeds: Array<{
    passport: string;
    status: VisaRequestStatus;
    packageType: VisaPackageType;
    amount: number;
    purpose: string;
    approval?: VisaApprovalStatus;
  }> = [
    {
      passport: "G000222222",
      status: VisaRequestStatus.READY_FOR_GIS_SUBMISSION,
      packageType: VisaPackageType.STANDARD,
      amount: 664,
      purpose: "Business conference",
    },
    {
      passport: "G000333333",
      status: VisaRequestStatus.EXPEDITED_AIRPORT_PAYMENT_PENDING,
      packageType: VisaPackageType.EXPEDITED,
      amount: 1450,
      purpose: "Family visit",
    },
    {
      passport: "G000444444",
      status: VisaRequestStatus.APPROVED,
      packageType: VisaPackageType.STANDARD,
      amount: 664,
      purpose: "Tourism",
      approval: VisaApprovalStatus.APPROVED,
    },
    {
      passport: "G000555555",
      status: VisaRequestStatus.REJECTED,
      packageType: VisaPackageType.STANDARD,
      amount: 664,
      purpose: "Tourism",
      approval: VisaApprovalStatus.REJECTED,
    },
    {
      passport: "G000666666",
      status: VisaRequestStatus.PAYMENT_FAILED,
      packageType: VisaPackageType.STANDARD,
      amount: 664,
      purpose: "Volunteering",
    },
    {
      passport: "G000777777",
      status: VisaRequestStatus.PENDING,
      packageType: VisaPackageType.STANDARD,
      amount: 664,
      purpose: "Tourism",
    },
  ];

  for (const seed of visaSeeds) {
    const existing = await prisma.visaOnArrivalData.findFirst({
      where: { passport_number: seed.passport },
    });
    if (existing) continue;

    const payment = await prisma.payment.create({
      data: {
        userId: demoUser.id,
        reference: `ADM-SEED-VISA-${seed.passport}`,
        targetType: PaymentTargetType.VISA_ON_ARRIVAL,
        targetId: "pending", // replaced below once the request exists
        amount: seed.amount,
        currency: "GHS",
        status:
          seed.status === VisaRequestStatus.PAYMENT_FAILED
            ? PaymentStatus.FAILED
            : PaymentStatus.SUCCESS,
        provider: "HUBTEL",
        description: `Visa on Arrival - ${seed.packageType}`,
      },
    });

    const request = await prisma.visaOnArrivalRequest.create({
      data: {
        userId: demoUser.id,
        status: seed.status,
        packageType: seed.packageType,
        paymentId: payment.id,
        visaData: {
          create: {
            passport_image_url: "https://images.unsplash.com/photo-1627123424574-724758594e93",
            bio_page_image_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
            flight_itinerary_image_url:
              "https://images.unsplash.com/photo-1436491865332-7a61a109cc05",
            passport_number: seed.passport,
            purpose_of_trip: seed.purpose,
            date_of_departure: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
            date_of_arrival: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
          },
        },
      },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { targetId: request.id },
    });

    if (seed.approval) {
      await prisma.visaApproval.create({
        data: {
          requestId: request.id,
          status: seed.approval,
          approvedBy: admin.id,
          approvedAt: new Date(),
          notes:
            seed.approval === VisaApprovalStatus.APPROVED
              ? "Documents verified"
              : "Incomplete documentation",
        },
      });
    }

    await prisma.adminActivityLog.create({
      data: {
        actorId: admin.id,
        entityType: "VISA_REQUEST",
        entityId: request.id,
        action: seed.approval ?? "PAYMENT_RECEIVED",
        note: `Seeded ${seed.passport} — ${seed.purpose}`,
      },
    });
  }

  // A SUCCESS payment on the confirmed tour booking so the payments table and
  // revenue KPIs include non-visa revenue too.
  const confirmedBooking = await prisma.tour_bookings.findUnique({
    where: { bookingReference: "DAGH-BOOK-CONFIRMED-001" },
  });
  if (confirmedBooking && !confirmedBooking.paymentId) {
    const payment = await prisma.payment.create({
      data: {
        userId: demoUser.id,
        reference: "ADM-SEED-BOOK-CONFIRMED-001",
        targetType: PaymentTargetType.TOUR_BOOKING,
        targetId: confirmedBooking.id,
        amount: Number(confirmedBooking.totalPrice),
        currency: "GHS",
        status: PaymentStatus.SUCCESS,
        provider: "HUBTEL",
        description: "Coastal Heritage Discovery — 2 pax",
      },
    });
    await prisma.tour_bookings.update({
      where: { id: confirmedBooking.id },
      data: { paymentId: payment.id },
    });
  }

  console.log("Admin console data seeded successfully.");
}

// ── Providers (hotels, tour guides, car rentals) ──────────────────────────
async function seedProviders() {
  console.log("Seeding providers...");

  const existing = await prisma.provider.count();
  if (existing > 0) {
    console.log(`${existing} providers already exist — skipping provider seeding.`);
    return;
  }

  const providers = [
    {
      displayName: "Labadi Beach Hotel",
      lat: 5.5515,
      lng: -0.1533,
      address: "12 La Road, Labadi, Accra",
      bio: "A 4-star beachfront hotel with ocean views, swimming pools and conference facilities.",
      rating: 4.4,
      reviews: 320,
      hotel: { apartment_type: ApartmentType.HOTEL, base_price_per_night: 1200 },
    },
    {
      displayName: "Airport View Hotel",
      lat: 5.6037,
      lng: -0.187,
      address: "19 White Avenue, Airport Residential Area, Accra",
      bio: "Contemporary hotel minutes from Kotoka International Airport.",
      rating: 4.2,
      reviews: 210,
      hotel: { apartment_type: ApartmentType.HOTEL, base_price_per_night: 900 },
    },
    {
      displayName: "Cantonments Guesthouse",
      lat: 5.5744,
      lng: -0.1875,
      address: "8 5th Avenue, Cantonments, Accra",
      bio: "A cosy guesthouse in a leafy residential neighbourhood.",
      rating: 4.6,
      reviews: 98,
      hotel: { apartment_type: ApartmentType.GUESTHOUSE, base_price_per_night: 450 },
    },
    {
      displayName: "Accra City Apartments",
      lat: 5.603,
      lng: -0.1982,
      address: "14 Ring Road Central, Accra",
      bio: "Furnished self-catering apartments ideal for longer stays.",
      rating: 4.0,
      reviews: 76,
      hotel: { apartment_type: ApartmentType.APARTMENTS, base_price_per_night: 700 },
    },
    // Regional supply so itinerary days outside Greater Accra resolve local
    // accommodation instead of null (all of the above sit in Accra).
    {
      displayName: "Cape Coast Seaside Airbnb",
      lat: 5.1031,
      lng: -1.2425,
      address: "26 Beach Road, Cape Coast",
      bio: "Bright self-catering Airbnb apartments a short walk from the castle.",
      rating: 4.5,
      reviews: 64,
      hotel: { apartment_type: ApartmentType.AIRBNB, base_price_per_night: 550 },
    },
    {
      displayName: "Kumasi Cultural Hotel",
      lat: 6.6885,
      lng: -1.6244,
      address: "12 Prempeh II Avenue, Adum, Kumasi",
      bio: "Central hotel convenient for Manhyia Palace and cultural sites.",
      rating: 4.3,
      reviews: 150,
      hotel: { apartment_type: ApartmentType.HOTEL, base_price_per_night: 800 },
    },
  ];

  for (const p of providers) {
    await prisma.provider.create({
      data: {
        verification_status: true,
        display_name: p.displayName,
        media_assets: ["https://images.unsplash.com/photo-1566073771259-6a8506099945"],
        location_lat: p.lat,
        location_lng: p.lng,
        location_address: p.address,
        avg_rating: p.rating,
        review_count: p.reviews,
        response_time_secs: 1800,
        bio_description: p.bio,
        hotel: { create: p.hotel },
      },
    });
  }

  // A verified tour guide provider
  await prisma.provider.create({
    data: {
      verification_status: true,
      display_name: "Kojo Asante — Tour Guide",
      media_assets: ["https://images.unsplash.com/photo-1500648767791-00dcc994a43e"],
      location_lat: 6.6885,
      location_lng: -1.6244,
      location_address: "Adum, Kumasi",
      avg_rating: 4.9,
      review_count: 45,
      response_time_secs: 900,
      bio_description: "Certified tour guide specialising in Ashanti history and cultural tours.",
      tour_guide: {
        create: {
          language_capability: ["English", "Twi", "French"],
          expertise_tags: ["Historical", "Cultural", "Nature"],
          charge_per_day: 800,
          certification_docs: ["https://example.com/cert.pdf"],
        },
      },
    },
  });

  // A verified car rental provider
  await prisma.provider.create({
    data: {
      verification_status: true,
      display_name: "DAGH Rentals",
      media_assets: ["https://images.unsplash.com/photo-1503376780353-7e6692767b70"],
      location_lat: 5.6037,
      location_lng: -0.187,
      location_address: "Airport Residential Area, Accra",
      avg_rating: 4.5,
      review_count: 132,
      response_time_secs: 3600,
      bio_description: "Modern, well-maintained vehicles with optional chauffeur service.",
      car_rental: {
        create: {
          vehicle_make: "Toyota",
          vehicle_model: "Highlander",
          vehicle_year: 2023,
          transmission: "Automatic",
          fuel_type: "Petrol",
          safety_features: ["Airbags", "ABS", "Reverse camera"],
          rental_terms_url: "https://example.com/terms",
          daily_rate: 650,
          driver_required: false,
          transport_type: TransportType.RENTED_VEHICLE,
        },
      },
    },
  });

  // City-ride supply so UBER selections resolve instead of null.
  await prisma.provider.create({
    data: {
      verification_status: true,
      display_name: "Accra City Rides",
      media_assets: ["https://images.unsplash.com/photo-1449965408869-eaa3f722e40d"],
      location_lat: 5.61,
      location_lng: -0.19,
      location_address: "Osu, Accra",
      avg_rating: 4.4,
      review_count: 88,
      response_time_secs: 900,
      bio_description: "On-demand city rides and airport transfers across Greater Accra.",
      car_rental: {
        create: {
          vehicle_make: "Toyota",
          vehicle_model: "Corolla",
          vehicle_year: 2022,
          transmission: "Automatic",
          fuel_type: "Petrol",
          safety_features: ["Airbags", "ABS"],
          rental_terms_url: "https://example.com/terms",
          daily_rate: 300,
          driver_required: true,
          transport_type: TransportType.UBER,
        },
      },
    },
  });

  // Regional shared-transport supply so Central/Ashanti touring days resolve
  // local transport instead of null (all Accra supply is >75km away).
  await prisma.provider.create({
    data: {
      verification_status: true,
      display_name: "Cape Coast Shuttle Services",
      media_assets: ["https://images.unsplash.com/photo-1570125909232-eb263c188f7e"],
      location_lat: 5.1054,
      location_lng: -1.2466,
      location_address: "Tantri Road, Cape Coast",
      avg_rating: 4.2,
      review_count: 57,
      response_time_secs: 1800,
      bio_description: "Shared shuttle and trotro charters along the Cape Coast–Elmina corridor.",
      car_rental: {
        create: {
          vehicle_make: "Mercedes-Benz",
          vehicle_model: "Sprinter",
          vehicle_year: 2021,
          transmission: "Manual",
          fuel_type: "Diesel",
          safety_features: ["Seatbelts", "First aid kit"],
          rental_terms_url: "https://example.com/terms",
          daily_rate: 400,
          driver_required: true,
          transport_type: TransportType.TROTRO,
        },
      },
    },
  });

  console.log("Providers seeded successfully.");
}

// ── Public transport catalog (§2: STC / VIP / trotro / air mobility) ────────
// Boarding-point based catalog consumed by the mobility engine. Coordinates
// are approximate city/station centroids — accurate enough for nearest-service
// ranking, not for navigation. Notes describe the boarding route / drop-off
// guidance the itinerary surfaces for rural and peri-urban sites.
const publicTransportServices: Prisma.PublicTransportServiceCreateManyInput[] = [
  // Intercity coaches — STC
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Kumasi",
    destinationRegion: "Ashanti",
    destinationLat: 6.694,
    destinationLng: -1.6244,
    notes: "Board at Circle; drops at Asafo area, central Kumasi.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Cape Coast",
    destinationRegion: "Central",
    destinationLat: 5.1054,
    destinationLng: -1.2466,
    notes: "Coastal corridor service; drops at Cape Coast main station.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Takoradi",
    destinationRegion: "Western",
    destinationLat: 4.8961,
    destinationLng: -1.7748,
    notes: "Western corridor service; drops central Takoradi.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Tamale",
    destinationRegion: "Northern",
    destinationLat: 9.4034,
    destinationLng: -0.8424,
    notes: "Northern corridor; long-haul service, book ahead.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Ho",
    destinationRegion: "Volta",
    destinationLat: 6.6111,
    destinationLng: 0.4714,
    notes: "Volta corridor service; drops at Ho main station area.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Kumasi",
    originStation: "Asafo Station (Kumasi)",
    originLat: 6.6969,
    originLng: -1.626,
    destinationCity: "Tamale",
    destinationRegion: "Northern",
    destinationLat: 9.4034,
    destinationLng: -0.8424,
    notes: "Up-north leg from the Ashanti hub.",
  },
  // Intercity coaches — VIP
  {
    mode: "INTERCITY_BUS",
    operator: "VIP",
    originCity: "Accra",
    originStation: "Circle / Neoplan Station (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Kumasi",
    destinationRegion: "Ashanti",
    destinationLat: 6.694,
    destinationLng: -1.6244,
    notes: "High-frequency Accra–Kumasi service; drops at Asafo.",
  },
  {
    mode: "INTERCITY_BUS",
    operator: "VIP",
    originCity: "Accra",
    originStation: "Circle / Neoplan Station (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Tamale",
    destinationRegion: "Northern",
    destinationLat: 9.4034,
    destinationLng: -0.8424,
    notes: "Northern route; long-haul service.",
  },
  // Local trotro corridors — station-of-origin + drop-off guidance
  {
    mode: "TROTRO",
    operator: "Trotro",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Cape Coast",
    destinationRegion: "Central",
    destinationLat: 5.1054,
    destinationLng: -1.2466,
    notes: "Board at Circle; alight Cape Coast main trotro station.",
  },
  {
    mode: "TROTRO",
    operator: "Trotro",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Kumasi",
    destinationRegion: "Ashanti",
    destinationLat: 6.694,
    destinationLng: -1.6244,
    notes: "Board at Circle; alight Asafo Station, Kumasi.",
  },
  {
    mode: "TROTRO",
    operator: "Trotro",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Takoradi",
    destinationRegion: "Western",
    destinationLat: 4.8961,
    destinationLng: -1.7748,
    notes: "Board at Circle; alight Market Circle, Takoradi.",
  },
  {
    mode: "TROTRO",
    operator: "Trotro",
    originCity: "Accra",
    originStation: "Kwame Nkrumah Circle (Accra)",
    originLat: 5.5711,
    originLng: -0.2119,
    destinationCity: "Ho",
    destinationRegion: "Volta",
    destinationLat: 6.6111,
    destinationLng: 0.4714,
    notes: "Board at Circle; alight Ho main station.",
  },
  {
    mode: "TROTRO",
    operator: "Trotro",
    originCity: "Kumasi",
    originStation: "Asafo Station (Kumasi)",
    originLat: 6.6969,
    originLng: -1.626,
    destinationCity: "Abono",
    destinationRegion: "Ashanti",
    destinationLat: 6.5167,
    destinationLng: -1.4667,
    notes: "Lake Bosomtwe gateway: alight Abono junction, then short taxi/trotro hop to the lake.",
  },
  // Domestic air — airports serving the tour corridors
  {
    mode: "DOMESTIC_AIR",
    operator: "Domestic Air",
    originCity: "Accra",
    originStation: "Kotoka International Airport (ACC)",
    originLat: 5.6051,
    originLng: -0.1668,
    destinationCity: null,
    destinationRegion: null,
    notes: "Domestic departures to Kumasi, Takoradi and Tamale.",
  },
  {
    mode: "DOMESTIC_AIR",
    operator: "Domestic Air",
    originCity: "Kumasi",
    originStation: "Kumasi Airport (KMS)",
    originLat: 6.7156,
    originLng: -1.5908,
    destinationCity: null,
    destinationRegion: null,
    notes: "Domestic flights to Accra.",
  },
  {
    mode: "DOMESTIC_AIR",
    operator: "Domestic Air",
    originCity: "Tamale",
    originStation: "Tamale Airport (TML)",
    originLat: 9.5571,
    originLng: -0.8632,
    destinationCity: null,
    destinationRegion: null,
    notes: "Domestic flights to Accra.",
  },
  {
    mode: "DOMESTIC_AIR",
    operator: "Domestic Air",
    originCity: "Takoradi",
    originStation: "Takoradi Airport (TKD)",
    originLat: 4.8961,
    originLng: -1.7748,
    destinationCity: null,
    destinationRegion: null,
    notes: "Domestic flights to Accra.",
  },
  {
    mode: "DOMESTIC_AIR",
    operator: "Domestic Air",
    originCity: "Ho",
    originStation: "Ho Airport (HOH)",
    originLat: 6.6008,
    originLng: 0.4699,
    destinationCity: null,
    destinationRegion: null,
    notes: "Domestic flights to Accra.",
  },
];

// Idempotent: rows are keyed by (mode, operator, originCity, destinationCity)
// — destinationCity IS NULL for airports, hence the explicit null match.
async function seedPublicTransportServices() {
  console.log("Seeding public transport services...");
  let created = 0;
  for (const service of publicTransportServices) {
    const existing = await prisma.publicTransportService.findFirst({
      where: {
        mode: service.mode,
        operator: service.operator,
        originCity: service.originCity,
        destinationCity: service.destinationCity ?? null,
      },
    });
    if (existing) {
      await prisma.publicTransportService.update({
        where: { id: existing.id },
        data: { ...service, active: true },
      });
    } else {
      await prisma.publicTransportService.create({ data: service });
      created += 1;
    }
  }
  console.log(
    `Public transport catalog seeded (${publicTransportServices.length} total, ${created} new).`,
  );
}

async function seedSitePhotoGalleries() {
  const sites = await prisma.tourSite.findMany({
    select: { id: true, name: true, imageUrl: true },
  });

  let created = 0;
  for (const site of sites) {
    if (!site.imageUrl) continue;

    // `publicId` acts as the idempotency marker so re-seeding never stacks
    // duplicate gallery rows on top of the seeded hero image.
    const marker = `seed-gallery:${site.name}`;
    const existing = await prisma.sitePhoto.findFirst({
      where: { tourSiteId: site.id, publicId: marker },
      select: { id: true, url: true },
    });
    if (existing) {
      // Keep the seeded gallery aligned when a unique-image override replaces
      // the previously shared hero photo.
      if (uniqueSiteImages[site.name] && existing.url !== site.imageUrl) {
        await prisma.sitePhoto.update({
          where: { id: existing.id },
          data: { url: site.imageUrl, thumbUrl: site.imageUrl },
        });
      }
      continue;
    }

    await prisma.sitePhoto.create({
      data: {
        tourSiteId: site.id,
        url: site.imageUrl,
        thumbUrl: site.imageUrl,
        publicId: marker,
        status: "APPROVED",
        moderatedAt: new Date(),
      },
    });
    created += 1;
  }

  console.log(`Site photo gallery: ${created} created across ${sites.length} sites.`);
}

async function main() {
  console.log("Seeding tour sites...");
  const existingSites = await prisma.tourSite.findMany({
    select: { id: true, name: true, history: true, imageUrl: true, imageCredit: true },
  });
  const existingByName = new Map(existingSites.map((site) => [site.name, site]));

  let created = 0;
  let enriched = 0;
  for (const site of tourSiteCatalogue) {
    const existing = existingByName.get(site.name);

    if (!existing) {
      await prisma.tourSite.create({ data: site });
      created += 1;
      continue;
    }

    // Fill content gaps on existing rows without overwriting admin edits. The
    // unique-image overrides are the exception: they exist precisely to replace
    // a shared fallback photo that makes different cards look identical.
    const patch: Prisma.TourSiteUpdateInput = {};
    if (!existing.history && site.history) patch.history = site.history;
    if (uniqueSiteImages[site.name]) {
      if (existing.imageUrl !== site.imageUrl) patch.imageUrl = site.imageUrl;
      if (existing.imageCredit !== site.imageCredit) patch.imageCredit = site.imageCredit;
    } else {
      if (!existing.imageUrl && site.imageUrl) patch.imageUrl = site.imageUrl;
      if (!existing.imageCredit && site.imageCredit) patch.imageCredit = site.imageCredit;
    }

    if (Object.keys(patch).length > 0) {
      await prisma.tourSite.update({ where: { id: existing.id }, data: patch });
      enriched += 1;
    }
  }

  console.log(
    `Tour site catalogue: ${created} created, ${enriched} enriched, ${tourSiteCatalogue.length} total.`,
  );

  // Backfill transit_profile for rows that predate the column (they all carry
  // the RURAL column default). Region-derivation is deterministic, so re-seeding
  // converges every environment onto the same mobility tiers.
  const seededSites = await prisma.tourSite.findMany({
    select: { id: true, region: true, transit_profile: true },
  });
  let profileCorrections = 0;
  for (const site of seededSites) {
    const derived = deriveTransitProfile(site.region);
    if (site.transit_profile !== derived) {
      await prisma.tourSite.update({
        where: { id: site.id },
        data: { transit_profile: derived },
      });
      profileCorrections += 1;
    }
  }
  if (profileCorrections > 0) {
    console.log(`Backfilled transit_profile on ${profileCorrections} tour sites.`);
  }

  await seedSitePhotoGalleries();

  await seedPublicTransportServices();

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

  // Seed Allowed Countries (jurisdiction allow-list)
  await prisma.allowedCountry.createMany({
    data: allowedCountries,
    skipDuplicates: true,
  });
  console.log(`Seeded ${allowedCountries.length} allowed countries (or already present).`);

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
        name: "Sankofa Membership",
        description: "Essential features for active diaspora members",
        price: 150,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "Access to all the core tools",
          "Prioritized profile for matches",
          "Entry gifts and discount packs",
          "24/7 client service",
        ],
        isMostPopular: true,
        isActive: true,
      },
      {
        code: "SENIOR_PIONEER",
        name: "Junior Pioneer",
        description: "For active users seeking more exposure",
        price: 300,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All features in Sankofa Membership",
          "Profile boost twice a week",
          "Free match and unlimited likes",
          "Special event access",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "SANKOFA_SETTLED",
        name: "Sankofa Settled",
        description: "For returnees and settled diaspora members",
        price: 150,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All features in Sankofa Membership",
          "Profile boost twice a week",
          "Free match and unlimited likes",
          "Special event access",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "GOLD_INVESTOR",
        name: "Gold Traveler",
        description: "Premium features for frequent travellers",
        price: 600,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All features in Sankofa Settled",
          "Priority booking on all tours",
          "VIP events and concierge service",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "ELITE_AMBASSADOR",
        name: "Elite Ambassador",
        description: "The ultimate membership for diaspora leaders",
        price: 900,
        currency: "GHS",
        interval: "MONTHLY",
        features: [
          "All features in Gold Traveler",
          "Dedicated ambassador hotline",
          "Exclusive investment & PR alerts",
          "Free VIP event access",
        ],
        isMostPopular: false,
        isActive: true,
      },
      {
        code: "FAMILY_PLAN",
        name: "Flexible Family Plan",
        description: "Cover your whole family under one plan",
        // Priced by product before it can be sold. A paid tier at 0 is refused at
        // checkout (see membership.service.ts) rather than activated for free, and
        // stays inactive here so it is not advertised at GHS 0 in the meantime.
        price: 0,
        currency: "GHS",
        interval: "CUSTOM",
        features: [
          "Up to 5 family members",
          "All features in Gold Traveler",
          "Custom group tours",
          "Dedicated family support",
        ],
        isMostPopular: false,
        isActive: false,
      },
    ];

    for (const plan of membershipPlans) {
      await prisma.membershipPlan.create({ data: plan });
    }

    console.log(`Seeded ${membershipPlans.length} membership plans successfully.`);
  }

  await seedDatingData();

  await seedDemoUsers();
  await seedTours();
  await seedTourBookings();
  await seedDatingInteractions();
  await seedVisaRequests();
  await seedAdminConsoleData();
  await seedProviders();

  console.log("✔ All seeds completed.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
