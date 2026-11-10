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
  /**
   * Marks a token that is deliberately not a session — an `mfaToken` or a
   * password-reset token. Those are signed by the same key as access tokens, so
   * without this check `jwt.verify` alone would happily accept a token that had
   * never cleared its second factor and let it open every route.
   */
  kind?: string;
}

export default async function protectedRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return fail(res, 401, "Not authenticated");
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, JWT_SECRET!) as AuthPayload;

    if (decoded.kind) {
      return fail(res, 401, "Incomplete authentication");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        accountType: true,
        fullName: true,
        ethnicity: true,
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

// Code from William

// export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
//   const authHeader = req.headers['authorization'];

//   const token = authHeader && authHeader.split(' ')[1];

//   if (!token) {
//     res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
//     return;
//   }

//   try {
//     const decoded = jwt.verify(token, JWT_SECRET) as { id: string };

//     req.user = { id: decoded.id };

//     next();
//   } catch (error) {
//     res.status(403).json({ success: false, error: 'Invalid or expired token.' });
//   }
// };
