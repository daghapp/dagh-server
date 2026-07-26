import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import crypto from "crypto";

/**
 * Get user call history logs
 */
export const getCallHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const callLogs = await prisma.callLog.findMany({
      where: {
        OR: [{ callerId: userId }, { receiverId: userId }],
      },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        caller: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
        receiver: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
      },
    });

    return ok(res, callLogs);
  } catch (error) {
    console.error("Get call history error:", error);
    return fail(res, 500, "Failed to fetch call history");
  }
};

/**
 * Generate WebRTC RTC session access token / room credentials
 * TODO: This is a placeholder HMAC token. For production, integrate with a
 * real WebRTC provider (LiveKit, Daily.co, Twilio) and return provider-native tokens.
 */
export const generateRtcToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId, callType = "VOICE" } = req.body;

    if (!roomId) {
      return fail(res, 400, "Room ID is required");
    }

    // Secure token hash for room authentication
    const tokenSecret = process.env.JWT_SECRET || "default_call_secret";
    const tokenPayload = `${userId}:${roomId}:${Date.now()}`;
    const token = crypto.createHmac("sha256", tokenSecret).update(tokenPayload).digest("hex");

    return ok(res, {
      roomId,
      userId,
      callType,
      token,
      expiresIn: 3600, // 1 hour token expiry
    });
  } catch (error) {
    console.error("Generate RTC token error:", error);
    return fail(res, 500, "Failed to generate RTC token");
  }
};
