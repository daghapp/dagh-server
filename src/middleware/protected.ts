import jwt, { JwtPayload } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/index.js";
import { fail } from "../helpers/response.js"; // Phase 3.4 — standardized error responses

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is not defined");
}

interface AuthPayload extends JwtPayload {
  id: string;
  email: string;
}

export default async function protectedRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return fail(res, 401, "Not authenticated");
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, JWT_SECRET!) as AuthPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        accountType: true,
        fullName: true,
      },
    });

    if (!user) {
      return fail(res, 401, "User no longer exists");
    }

    req.user = user;
    next();
  } catch {
    return fail(res, 401, "Invalid or expired token");
  }
}
