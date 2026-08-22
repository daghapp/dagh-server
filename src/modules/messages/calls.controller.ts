import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { getCallServiceUrl } from "../../helpers/call-service.js";
import { generateLiveKitRoomToken } from "../../helpers/livekit.js";
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
 * Generate a LiveKit AccessToken for a call room. When LiveKit is not
 * configured (no LIVEKIT_* env vars), falls back to a placeholder HMAC
 * token for local development.
 */
export const generateRtcToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId, callType = "VOICE" } = req.body;

    if (!roomId) {
      return fail(res, 400, "Room ID is required");
    }

    const liveKitToken = await generateLiveKitRoomToken({
      roomId,
      identity: userId,
      name: req.user!.fullName,
    });

    if (liveKitToken) {
      return ok(res, {
        roomId,
        userId,
        callType,
        token: liveKitToken.token,
        serviceUrl: liveKitToken.serviceUrl,
        expiresIn: liveKitToken.expiresIn,
      });
    }

    // Placeholder HMAC token for dev environments without LiveKit
    const tokenSecret = process.env.JWT_ACCESS_SECRET || "default_call_secret";
    const tokenPayload = `${userId}:${roomId}:${Date.now()}`;
    const token = crypto.createHmac("sha256", tokenSecret).update(tokenPayload).digest("hex");

    const serviceUrl = getCallServiceUrl() || `${req.protocol}://${req.get("host")}`;

    return ok(res, {
      roomId,
      userId,
      callType,
      token,
      serviceUrl,
      expiresIn: 3600, // 1 hour token expiry
    });
  } catch (error) {
    console.error("Generate RTC token error:", error);
    return fail(res, 500, "Failed to generate RTC token");
  }
};
