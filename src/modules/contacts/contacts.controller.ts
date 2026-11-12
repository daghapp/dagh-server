import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import * as contactsService from "./contacts.service.js";

function extractContacts(body: any): any[] {
  if (!body) return [];
  if (Array.isArray(body.contacts)) return body.contacts;
  if (Array.isArray(body.phoneNumbers)) return body.phoneNumbers;
  if (Array.isArray(body.phones)) return body.phones;
  if (Array.isArray(body.hashes)) return body.hashes;
  if (Array.isArray(body)) return body;
  return [];
}

export class ContactsController {
  async sync(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const contacts = extractContacts(req.body);
      const result = await contactsService.syncContacts(userId, contacts);
      return ok(res, result, "Contacts synced");
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
      const userId = (req as any).user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const matches = contactsService.getContactMatches(userId);
      const banner =
        matches.length === 0
          ? "No contacts found on Diaspora Sync yet."
          : `${matches.length} people in your contact list are already on Diaspora Sync! Tap to connect.`;
      return ok(res, { matches, matchedCount: matches.length, banner });
    } catch (error) {
      console.error("[contacts.getMatches]", error);
      return fail(res, 500, "Failed to fetch matches");
    }
  }

  async clear(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      contactsService.clearContactMatches(userId);
      return ok(res, { cleared: true });
    } catch (error) {
      console.error("[contacts.clear]", error);
      return fail(res, 500, "Failed to clear matches");
    }
  }
}

export const contactsController = new ContactsController();
