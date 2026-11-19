import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as contactsService from "./contacts.service.js";
import type { ContactInput } from "./contacts.service.js";

function extractContacts(body: unknown): Array<ContactInput | string> {
  if (!body) return [];
  if (Array.isArray(body)) return body as Array<ContactInput | string>;
  if (typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of ["contacts", "phoneNumbers", "phones", "hashes"]) {
    if (Array.isArray(record[key])) return record[key] as Array<ContactInput | string>;
  }
  return [];
}

export class ContactsController {
  async sync(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const contacts = extractContacts(req.body);
      const [result, invite] = await Promise.all([
        contactsService.syncContacts(userId, contacts),
        contactsService.buildInviteLink(userId),
      ]);
      return ok(res, { ...result, invite }, "Contacts synced");
    } catch (error) {
      console.error("[contacts.sync]", error);
      return fail(res, 500, "Failed to sync contacts");
    }
  }

  async match(req: Request, res: Response) {
    return this.sync(req, res);
  }

  async getMatches(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const [matches, invite] = await Promise.all([
        contactsService.getContactMatches(userId),
        contactsService.buildInviteLink(userId),
      ]);
      const banner =
        matches.length === 0
          ? "No contacts found on Diaspora Sync yet. Invite them to join."
          : `${matches.length} people in your contact list are already on Diaspora Sync! Tap to connect.`;
      return ok(res, {
        matches,
        matchedCount: matches.length,
        banner,
        invite,
      });
    } catch (error) {
      console.error("[contacts.getMatches]", error);
      return fail(res, 500, "Failed to fetch matches");
    }
  }

  /** Shareable app invite link for contacts who are not on the platform yet. */
  async getInviteLink(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const invite = await contactsService.buildInviteLink(userId);
      return ok(res, invite, "Invite link generated");
    } catch (error) {
      console.error("[contacts.invite]", error);
      return fail(res, 500, "Failed to generate invite link");
    }
  }

  async clear(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      await contactsService.clearContactMatches(userId);
      return ok(res, { cleared: true });
    } catch (error) {
      console.error("[contacts.clear]", error);
      return fail(res, 500, "Failed to clear matches");
    }
  }
}

export const contactsController = new ContactsController();
