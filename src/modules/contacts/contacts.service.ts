import crypto from "crypto";
import { prisma } from "../../config/index.js";
import { hashPhoneNumber, normalizePhoneNumber } from "../../helpers/phoneHash.js";

export interface ContactInput {
  name?: string;
  phone?: string;
  phoneNumber?: string;
  hash?: string;
  phoneHash?: string;
}

export interface ContactMatch {
  userId: string;
  name: string | null;
  phoneNumber: string | null;
}

const inMemoryMatches = new Map<string, ContactMatch[]>();

export function hashPhone(phone: string | null | undefined): string {
  return hashPhoneNumber(phone);
}
export const hashContacts = hashContactsList;
export const hashPhoneNumbers = hashContactsList;
export function hashContact(phone: string | null | undefined): string {
  return hashPhoneNumber(phone);
}

export function normalizePhone(phone: string | null | undefined): string {
  return normalizePhoneNumber(phone);
}

function extractPhones(contacts: Array<ContactInput | string>): string[] {
  const out: string[] = [];
  for (const c of contacts || []) {
    if (typeof c === "string") {
      out.push(c);
    } else if (c) {
      if (c.phone) out.push(c.phone);
      else if (c.phoneNumber) out.push(c.phoneNumber);
      else if (c.hash) out.push(c.hash);
      else if (c.phoneHash) out.push(c.phoneHash);
    }
  }
  return out;
}

export function hashContactsList(contacts: Array<ContactInput | string>): string[] {
  const phones = extractPhones(contacts);
  const hashes: string[] = [];
  for (const p of phones) {
    // If caller already passed a 64-char hex hash, keep it.
    if (/^[a-f0-9]{64}$/i.test(p.trim())) {
      hashes.push(p.trim().toLowerCase());
    } else {
      const h = hashPhoneNumber(p);
      if (h) hashes.push(h);
    }
  }
  return Array.from(new Set(hashes));
}

export async function matchContacts(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<{
  matchedCount: number;
  matches: ContactMatch[];
  totalContacts: number;
  banner: string;
}> {
  const hashes = hashContactsList(contacts);
  let users: any[];
  try {
    users = await (prisma as any).user.findMany({
      where: {
        OR: [{ phoneNumberHash: { in: hashes } }, { phoneHash: { in: hashes } }],
        id: { not: userId },
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        phoneNumber: true,
        phoneNumberHash: true,
        phoneHash: true,
      },
    });
  } catch {
    // Fallback: load all users and filter by hashed phone.
    const all = await (prisma as any).user.findMany({
      select: { id: true, fullName: true, username: true, phoneNumber: true },
    });
    const set = new Set(hashes);
    users = (all || []).filter((u: any) => {
      if (u.id === userId) return false;
      const h = hashPhoneNumber(u.phoneNumber);
      return h && set.has(h);
    });
  }

  const matches: ContactMatch[] = (users || []).map((u: any) => ({
    userId: u.id,
    name: u.fullName || u.username || null,
    phoneNumber: u.phoneNumber || null,
  }));

  inMemoryMatches.set(userId, matches);

  const names = matches.map((m) => m.name).filter(Boolean);
  const firstName = names[0] || "someone";
  const banner =
    matches.length === 0
      ? "No contacts found on Diaspora Sync yet."
      : matches.length === 1
        ? `1 person in your contact list (${firstName}) is already on Diaspora Sync! Tap to connect.`
        : `${matches.length} people in your contact list (including ${firstName}) are already on Diaspora Sync! Tap to connect.`;

  // Best-effort push notification for the newly registered user.
  if (matches.length > 0) {
    try {
      const { prisma } = await import("../../config/index.js");
      const devices = await (prisma as any).userDevice.findMany({
        where: { userId, enabled: true },
      });
      const expoModule = await import("expo-server-sdk");
      const ExpoCtor = (expoModule as any).Expo || (expoModule as any).default?.Expo;
      const expo = new ExpoCtor();
      const messages: any[] = [];
      for (const device of devices || []) {
        const token = device.expoPushToken;
        if (token && ExpoCtor.isExpoPushToken(token)) {
          messages.push({
            to: token,
            title: "Diaspora Sync",
            body: banner,
            data: { type: "CONTACT_MATCH" },
          });
        }
      }
      if (messages.length) {
        await expo.sendPushNotificationsAsync(messages);
      }
    } catch {
      // ignore push failures
    }
  }

  return {
    matchedCount: matches.length,
    matches,
    totalContacts: hashes.length,
    banner,
  };
}

export async function syncContacts(
  userId: string,
  contacts: Array<ContactInput | string> = [],
): Promise<ReturnType<typeof matchContacts>> {
  return matchContacts(userId, contacts);
}

export function getContactMatches(userId: string): ContactMatch[] {
  return inMemoryMatches.get(userId) || [];
}

export function clearContactMatches(userId: string): void {
  inMemoryMatches.delete(userId);
}

// Aliases
export const syncContactBook = syncContacts;
export const matchContactBook = matchContacts;
export const findContactsOnPlatform = matchContacts;
export const getMatchedContacts = getContactMatches;

export const findMatchingContacts = matchContacts;
export const findContacts = matchContacts;
export const matchContactPhones = matchContacts;
export const syncContactPhones = syncContacts;
