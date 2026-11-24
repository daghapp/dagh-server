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

type DatingContactErrorCode =
  | "CONTACT_CONSENT_REQUIRED"
  | "CONTACT_LIST_TOO_COMPLEX"
  | "CONTACT_SYNC_TIMEOUT"
  | "CONTACT_SYNC_FAILED"
  | "CONTACT_MATCHES_UNAVAILABLE"
  | "CONTACT_STATUS_UNAVAILABLE"
  | "CONTACT_ACCESS_REVOKE_FAILED";

interface FriendlyDatingContactError {
  status: number;
  error: string;
  code: DatingContactErrorCode;
  retryable: boolean;
}

export function friendlyDatingContactError(
  error: unknown,
  fallback: { error: string; code: DatingContactErrorCode },
): FriendlyDatingContactError {
  if (error instanceof Error && error.message === "CONTACT_CONSENT_REQUIRED") {
    return {
      status: 403,
      error: "Contact access permission is required before syncing contacts for dating.",
      code: "CONTACT_CONSENT_REQUIRED",
      retryable: false,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (
    /bind message|08P01|parameter formats|too many parameters|prepared statement/i.test(message)
  ) {
    return {
      status: 422,
      error: "We couldn't process this contact list. Try syncing again with fewer contacts.",
      code: "CONTACT_LIST_TOO_COMPLEX",
      retryable: true,
    };
  }
  if (/timeout|timed out|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message)) {
    return {
      status: 504,
      error: "Contact sync is taking longer than expected. Please try again.",
      code: "CONTACT_SYNC_TIMEOUT",
      retryable: true,
    };
  }
  return {
    status: 503,
    error: fallback.error,
    code: fallback.code,
    retryable: true,
  };
}

function respondWithDatingContactError(
  res: Response,
  label: string,
  error: unknown,
  fallback: { error: string; code: DatingContactErrorCode },
): Response {
  console.error(label, error);
  const friendly = friendlyDatingContactError(error, fallback);
  return fail(res, friendly.status, friendly.error, {
    code: friendly.code,
    retryable: friendly.retryable,
  });
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
    return respondWithDatingContactError(res, "[dating.contacts.sync]", error, {
      error: "Contacts couldn't be synced right now. Please try again.",
      code: "CONTACT_SYNC_FAILED",
    });
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
    return respondWithDatingContactError(res, "[dating.contacts.matches]", error, {
      error: "We couldn't load your contact matches right now. Please try again.",
      code: "CONTACT_MATCHES_UNAVAILABLE",
    });
  }
};

/** Whether contact sync is enabled, plus the last sync/match counts. */
export const getContactsForDatingStatus = async (req: Request, res: Response) => {
  try {
    const status = await getContactSyncStatus(req.user!.id);
    return ok(res, status);
  } catch (error) {
    return respondWithDatingContactError(res, "[dating.contacts.status]", error, {
      error: "We couldn't load your contact sync status right now. Please try again.",
      code: "CONTACT_STATUS_UNAVAILABLE",
    });
  }
};

/** Revoke contact permission and delete all derived matches. */
export const deleteContactsForDating = async (req: Request, res: Response) => {
  try {
    await revokeDatingContactConsent(req.user!.id);
    return ok(res, { granted: false }, "Contact access revoked");
  } catch (error) {
    return respondWithDatingContactError(res, "[dating.contacts.revoke]", error, {
      error: "We couldn't revoke contact access right now. Please try again.",
      code: "CONTACT_ACCESS_REVOKE_FAILED",
    });
  }
};
