import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import {
  getContactSyncStatus,
  getDatingContactMatches,
  revokeDatingContactConsent,
  syncDatingContacts,
} from "../../services/dating-contacts.service.js";
import { buildInviteLink } from "../contacts/contacts.service.js";
import type { ContactInput } from "../contacts/contacts.service.js";

function extractContacts(body: Record<string, unknown>): Array<ContactInput | string> {
  if (!body) return [];
  if (Array.isArray(body.contacts)) return body.contacts;
  if (Array.isArray(body.phoneNumbers)) return body.phoneNumbers;
  if (Array.isArray(body.phones)) return body.phones;
  if (Array.isArray(body.hashes)) return body.hashes;
  return [];
}

/**
 * Sync the caller's contacts for dating discovery.
 *
 * The client must have obtained OS-level contact permission and pass `consent:
 * true` on the first sync (or have previously granted consent). Only SHA-256
 * phone hashes are sent/stored; raw contact data is never returned.
 */
export const syncContactsForDating = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const contacts = extractContacts(body);
    const consent = body.consent === true;

    if (contacts.length === 0) {
      return fail(res, 400, "At least one contact is required");
    }

    const result = await syncDatingContacts(userId, contacts, consent);
    return ok(res, result, "Contacts synced for dating discovery");
  } catch (error) {
    if (error instanceof Error && error.message === "CONTACT_CONSENT_REQUIRED") {
      return fail(
        res,
        403,
        "Contact access permission is required before syncing contacts for dating.",
      );
    }
    console.error("[dating.contacts.sync]", error);
    return fail(res, 500, "Failed to sync contacts");
  }
};

/** List people in the caller's contacts who are on the platform. */
export const getContactsForDating = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const allGenders = req.query.allGenders === "true" || req.query.scope === "people";
    const matches = await getDatingContactMatches(userId, { allGenders });
    let invite: Awaited<ReturnType<typeof buildInviteLink>> | null = null;
    try {
      invite = await buildInviteLink(userId);
    } catch (error) {
      console.warn("[dating.contacts.matches] failed to build invite link", error);
    }
    const banner =
      matches.length === 0
        ? "No contacts found on Diaspora Sync yet. Invite them to join."
        : `${matches.length} people in your contact list are on Diaspora Sync. Tap to connect.`;

    return ok(res, { matches, matchedCount: matches.length, banner, invite });
  } catch (error) {
    console.error("[dating.contacts.matches]", error);
    return fail(res, 500, "Failed to fetch contact matches");
  }
};

/** Whether contact sync is enabled, plus the last sync/match counts. */
export const getContactsForDatingStatus = async (req: Request, res: Response) => {
  try {
    const status = await getContactSyncStatus(req.user!.id);
    return ok(res, status);
  } catch (error) {
    console.error("[dating.contacts.status]", error);
    return fail(res, 500, "Failed to fetch contact sync status");
  }
};

/** Revoke contact permission and delete all derived matches. */
export const deleteContactsForDating = async (req: Request, res: Response) => {
  try {
    await revokeDatingContactConsent(req.user!.id);
    return ok(res, { granted: false }, "Contact access revoked");
  } catch (error) {
    console.error("[dating.contacts.revoke]", error);
    return fail(res, 500, "Failed to revoke contact access");
  }
};
