import { Request, Response, NextFunction } from "express";

/**
 * Middleware to check if the authenticated user is an admin
 * Must be used after the protectedRoute middleware
 */
export default function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user;

  if (!user || user.accountType !== "ADMIN") {
    return res.status(403).json({ message: "Unauthorized access" });
  }

  next();
}
