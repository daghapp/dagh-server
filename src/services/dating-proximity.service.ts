import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "../config/index.js";
import { haversineKm } from "./matching.service.js";
import { canDatingInteract } from "../helpers/dating-gender.js";

const expo = new Expo();

/** Never alert beyond this radius, even when the user's discovery range is wider. */
const PROXIMITY_ALERT_RADIUS_KM = 10;

/** At most one alert per pair per day. */
const PROXIMITY_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Ignore locations older than this so stale positions do not trigger alerts. */
const LOCATION_FRESHNESS_MS = 12 * 60 * 60 * 1000;

const MAX_CANDIDATES = 2000;

interface ProximityCandidate {
  userId: string;
  gender: string | null;
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
}

interface ProximityPair {
  a: ProximityCandidate;
  b: ProximityCandidate;
  distanceKm: number;
}

interface PendingAlert {
  userId: string;
  nearbyUserId: string;
  distanceKm: number;
}

/**
 * Scan recent dating locations and deliver a non-identifying "someone nearby"
 * push to each user. Pairs are deduplicated per day so users are not spammed.
 *
 * Returns the number of alerts that were actually queued for delivery.
 */
export async function sendDatingProximityAlerts(): Promise<number> {
  const now = new Date();
  const freshSince = new Date(now.getTime() - LOCATION_FRESHNESS_MS);
  const cooldownSince = new Date(now.getTime() - PROXIMITY_ALERT_COOLDOWN_MS);

  const preferences = await prisma.discoveryPreference.findMany({
    where: {
      showProfile: true,
      locationLat: { not: null },
      locationLng: { not: null },
      locationUpdatedAt: { gte: freshSince },
      user: {
        accountStatus: "ACTIVE",
        isDeleted: false,
        datingProfile: { isNot: null },
      },
    },
    select: {
      userId: true,
      locationLat: true,
      locationLng: true,
      maxDistanceKm: true,
      user: { select: { gender: true } },
    },
    take: MAX_CANDIDATES,
  });

  const candidates: ProximityCandidate[] = preferences
    .filter(
      (p): p is typeof p & { locationLat: number; locationLng: number } =>
        p.locationLat !== null && p.locationLng !== null,
    )
    .map((p) => ({
      userId: p.userId,
      gender: p.user.gender,
      latitude: p.locationLat,
      longitude: p.locationLng,
      maxDistanceKm: p.maxDistanceKm,
    }));

  if (candidates.length < 2) return 0;

  const ids = candidates.map((c) => c.userId);
  const [blocks, recentAlerts, devices] = await Promise.all([
    prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }],
      },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.datingProximityNotification.findMany({
      where: { userId: { in: ids }, notifiedAt: { gte: cooldownSince } },
      select: { userId: true, nearbyUserId: true },
    }),
    prisma.userDevice.findMany({
      where: { userId: { in: ids }, enabled: true, expoPushToken: { not: null } },
      select: { userId: true, expoPushToken: true },
    }),
  ]);

  const blockedPairs = new Set<string>();
  for (const block of blocks) {
    blockedPairs.add(`${block.blockerId}:${block.blockedId}`);
    blockedPairs.add(`${block.blockedId}:${block.blockerId}`);
  }

  // At most one proximity alert per user per day, regardless of which nearby
  // user triggered it — otherwise a dense area would produce a steady stream.
  const recentlyAlertedRecipients = new Set(recentAlerts.map((row) => row.userId));

  const tokensByUser = new Map<string, string[]>();
  for (const device of devices) {
    if (!device.expoPushToken || !Expo.isExpoPushToken(device.expoPushToken)) continue;
    const tokens = tokensByUser.get(device.userId) ?? [];
    tokens.push(device.expoPushToken);
    tokensByUser.set(device.userId, tokens);
  }

  const pairs: ProximityPair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const aRadius = Math.min(PROXIMITY_ALERT_RADIUS_KM, a.maxDistanceKm);

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (!canDatingInteract(a.gender, b.gender) || !canDatingInteract(b.gender, a.gender)) {
        continue;
      }

      const pairKey = `${a.userId}:${b.userId}`;
      if (blockedPairs.has(pairKey)) continue;

      const distanceKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
      const radius = Math.min(aRadius, PROXIMITY_ALERT_RADIUS_KM, b.maxDistanceKm);
      if (distanceKm > radius) continue;

      pairs.push({ a, b, distanceKm });
    }
  }

  // Closest pairs first so each user gets the most relevant single alert.
  pairs.sort((x, y) => x.distanceKm - y.distanceKm);

  const alertedThisScan = new Set<string>();
  const pending: PendingAlert[] = [];

  for (const pair of pairs) {
    for (const [recipient, nearby] of [
      [pair.a, pair.b],
      [pair.b, pair.a],
    ] as const) {
      if (alertedThisScan.has(recipient.userId)) continue;
      if (recentlyAlertedRecipients.has(recipient.userId)) continue;
      if (!tokensByUser.has(recipient.userId)) continue;

      pending.push({
        userId: recipient.userId,
        nearbyUserId: nearby.userId,
        distanceKm: pair.distanceKm,
      });
      alertedThisScan.add(recipient.userId);
    }
  }

  if (pending.length === 0) return 0;

  const messages: ExpoPushMessage[] = [];
  for (const alert of pending) {
    const distance = Math.max(1, Math.round(alert.distanceKm));
    for (const token of tokensByUser.get(alert.userId) ?? []) {
      messages.push({
        to: token,
        title: "Someone is nearby",
        body: `A dating member is within ${distance} km of you. Open Discovery to see who's around.`,
        data: {
          type: "DATING_NEARBY",
          distanceKm: String(distance),
          route: "/dating/discovery",
        },
        sound: "default",
      });
    }
  }

  if (messages.length === 0) return 0;

  await expo.sendPushNotificationsAsync(messages);

  await prisma.$transaction(
    pending.map((alert) =>
      prisma.datingProximityNotification.upsert({
        where: {
          userId_nearbyUserId: {
            userId: alert.userId,
            nearbyUserId: alert.nearbyUserId,
          },
        },
        create: {
          userId: alert.userId,
          nearbyUserId: alert.nearbyUserId,
          distanceKm: alert.distanceKm,
          notifiedAt: now,
        },
        update: {
          distanceKm: alert.distanceKm,
          notifiedAt: now,
        },
      }),
    ),
  );

  return pending.length;
}
