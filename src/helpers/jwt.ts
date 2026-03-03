import jwt from "jsonwebtoken";
import { prisma } from "../config/index.js";

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error(
    "Missing JWT_SECRET environment variable. Please set it in your environment.",
  );
}

if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "Missing JWT_REFRESH_SECRET environment variable. Please set it in your environment.",
  );
}
interface JwtPayload {
  id: string;
  email: string;
  accountType?: string;
}

const AccessTokenSecret = process.env.JWT_ACCESS_SECRET as string;
const RefreshTokenSecret = process.env.JWT_REFRESH_SECRET as string;

// Generate Access Token (shorter life)
export function generateAccessToken(user: JwtPayload) {
  const token = jwt.sign(
    { id: user.id, email: user.email, accountType: user.accountType },
    AccessTokenSecret,
    { expiresIn: "1d" },
  );

  return token;
}

// Generate Refresh Token (stored in DB)
export async function generateRefreshToken(user: JwtPayload) {
  //check if a refresh token already exists for the user
  const existingToken = await prisma.deviceToken.findFirst({
    where: { userId: user.id },
  });

  if (existingToken && existingToken.expiredAt! > new Date())
    return existingToken.token;
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, accountType: user.accountType },
    RefreshTokenSecret,
    { expiresIn: "7d" },
  );

  await prisma.deviceToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      platform: "WEB",
      expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  return refreshToken;
}
