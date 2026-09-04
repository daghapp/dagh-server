import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

const POLICY_KEY = "data-policy";

/**
 * Public endpoint: return the current published data policy.
 * Returns the raw policy document for display in the mobile app.
 */
export const getDataPolicy = async (_req: Request, res: Response) => {
  try {
    const policy = await prisma.dataPolicy.findUnique({
      where: { key: POLICY_KEY },
    });

    if (!policy) {
      return fail(res, 404, "Data policy not found");
    }

    return ok(res, {
      title: policy.title,
      content: policy.content,
      version: policy.version,
      updatedAt: policy.updatedAt,
    });
  } catch (error) {
    console.error("[DataPolicy] get error:", error);
    return fail(res, 500, "Failed to fetch data policy");
  }
};

/**
 * Admin endpoint: return the full data policy record for editing.
 */
export const adminGetDataPolicy = async (_req: Request, res: Response) => {
  try {
    const policy = await prisma.dataPolicy.findUnique({
      where: { key: POLICY_KEY },
    });

    if (!policy) {
      return fail(res, 404, "Data policy not found");
    }

    return ok(res, policy);
  } catch (error) {
    console.error("[DataPolicy] admin get error:", error);
    return fail(res, 500, "Failed to fetch data policy");
  }
};

/**
 * Admin endpoint: update the data policy content.
 * Versions are incremented on each content change to track revisions.
 */
export const adminUpdateDataPolicy = async (req: Request, res: Response) => {
  try {
    const { content, title } = req.body;

    if (typeof content !== "string" || content.trim().length === 0) {
      return fail(res, 400, "content must be a non-empty string");
    }

    const existing = await prisma.dataPolicy.findUnique({
      where: { key: POLICY_KEY },
    });

    if (!existing) {
      return fail(res, 404, "Data policy not found. It must be seeded before it can be edited.");
    }

    const policy = await prisma.dataPolicy.update({
      where: { id: existing.id },
      data: {
        content,
        ...(typeof title === "string" && title.trim() ? { title } : {}),
        version: content !== existing.content ? { increment: 1 } : existing.version,
        publishedAt: new Date(),
      },
    });

    return ok(res, policy, "Data policy updated successfully");
  } catch (error) {
    console.error("[DataPolicy] admin update error:", error);
    return fail(res, 500, "Failed to update data policy");
  }
};
