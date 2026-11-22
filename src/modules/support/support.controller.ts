import { Request, Response } from "express";
import type { SupportTicketStatus } from "../../../generated/prisma/enums.js";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

export class SupportController {
  async createTicket(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const { subject, message } = req.body || {};
      if (!subject || !message) return fail(res, 400, "subject and message are required");
      const ticket = await prisma.supportTicket.create({
        data: { userId, subject: String(subject), message: String(message) },
      });
      return ok(res, ticket, "Support ticket created");
    } catch (error) {
      console.error("[support.createTicket]", error);
      return fail(res, 500, "Failed to create support ticket");
    }
  }

  async listMyTickets(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const tickets = await prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return ok(res, tickets);
    } catch (error) {
      console.error("[support.listMyTickets]", error);
      return fail(res, 500, "Failed to fetch support tickets");
    }
  }

  async getTicket(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const id = String(req.params.id);
      const ticket = await prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) return fail(res, 404, "Ticket not found");
      const user = req.user;
      if (ticket.userId !== userId && user?.accountType !== "ADMIN") {
        return fail(res, 403, "Forbidden");
      }
      return ok(res, ticket);
    } catch (error) {
      console.error("[support.getTicket]", error);
      return fail(res, 500, "Failed to fetch support ticket");
    }
  }

  async listAllTickets(req: Request, res: Response) {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const where = status ? { status: status as SupportTicketStatus } : {};
      const tickets = await prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
      return ok(res, tickets);
    } catch (error) {
      console.error("[support.listAllTickets]", error);
      return fail(res, 500, "Failed to fetch support tickets");
    }
  }

  async replyTicket(req: Request, res: Response) {
    try {
      const adminId = req.user?.id;
      const id = String(req.params.id);
      const { reply, status } = req.body || {};
      if (!reply) return fail(res, 400, "reply is required");
      const ticket = await prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) return fail(res, 404, "Ticket not found");
      const updated = await prisma.supportTicket.update({
        where: { id },
        data: {
          adminReply: String(reply),
          repliedAt: new Date(),
          repliedBy: adminId,
          status: status || "IN_PROGRESS",
        },
      });
      return ok(res, updated, "Reply sent");
    } catch (error) {
      console.error("[support.replyTicket]", error);
      return fail(res, 500, "Failed to reply to support ticket");
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { status } = req.body || {};
      if (!status) return fail(res, 400, "status is required");
      const ticket = await prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) return fail(res, 404, "Ticket not found");
      const updated = await prisma.supportTicket.update({
        where: { id },
        data: { status: String(status) as SupportTicketStatus },
      });
      return ok(res, updated, "Status updated");
    } catch (error) {
      console.error("[support.updateStatus]", error);
      return fail(res, 500, "Failed to update support ticket");
    }
  }
}

export const supportController = new SupportController();
