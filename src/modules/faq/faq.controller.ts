import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

/**
 * Public endpoint: return all published FAQ items, ordered by category and sort order.
 */
export const getFaqItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.faqItem.findMany({
      where: { published: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        sortOrder: true,
      },
    });

    return ok(res, items);
  } catch (error) {
    console.error("[Faq] get error:", error);
    return fail(res, 500, "Failed to fetch FAQ items");
  }
};

/**
 * Admin endpoint: return all FAQ items (including unpublished).
 */
export const adminGetFaqItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.faqItem.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok(res, items);
  } catch (error) {
    console.error("[Faq] admin get error:", error);
    return fail(res, 500, "Failed to fetch FAQ items");
  }
};

/**
 * Admin endpoint: create a new FAQ item.
 */
export const adminCreateFaqItem = async (req: Request, res: Response) => {
  try {
    const { question, answer, category, sortOrder, published } = req.body;

    const item = await prisma.faqItem.create({
      data: {
        question,
        answer,
        category: category ?? null,
        sortOrder: sortOrder ?? 0,
        published: published ?? true,
      },
    });

    return ok(res, item, "FAQ item created successfully");
  } catch (error) {
    console.error("[Faq] admin create error:", error);
    return fail(res, 500, "Failed to create FAQ item");
  }
};

/**
 * Admin endpoint: update an existing FAQ item.
 */
export const adminUpdateFaqItem = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { question, answer, category, sortOrder, published } = req.body;

    const existing = await prisma.faqItem.findUnique({ where: { id } });
    if (!existing) {
      return fail(res, 404, "FAQ item not found");
    }

    const item = await prisma.faqItem.update({
      where: { id },
      data: {
        ...(question !== undefined && { question }),
        ...(answer !== undefined && { answer }),
        ...(category !== undefined && { category: category ?? null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(published !== undefined && { published }),
      },
    });

    return ok(res, item, "FAQ item updated successfully");
  } catch (error) {
    console.error("[Faq] admin update error:", error);
    return fail(res, 500, "Failed to update FAQ item");
  }
};

/**
 * Admin endpoint: delete an FAQ item.
 */
export const adminDeleteFaqItem = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const existing = await prisma.faqItem.findUnique({ where: { id } });
    if (!existing) {
      return fail(res, 404, "FAQ item not found");
    }

    await prisma.faqItem.delete({ where: { id } });

    return ok(res, null, "FAQ item deleted successfully");
  } catch (error) {
    console.error("[Faq] admin delete error:", error);
    return fail(res, 500, "Failed to delete FAQ item");
  }
};
