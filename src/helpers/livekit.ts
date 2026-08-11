import { AccessToken, type VideoGrant } from "livekit-server-sdk";

const liveKitConfig = () => ({
  url: process.env.LIVEKIT_URL?.trim() || "",
  apiKey: process.env.LIVEKIT_API_KEY?.trim() || "",
  apiSecret: process.env.LIVEKIT_API_SECRET?.trim() || "",
});

/**
 * True when all LiveKit env vars are present, so a real media token
 * can be issued instead of the placeholder HMAC fallback.
 */
export const isLiveKitConfigured = (): boolean => {
  const { url, apiKey, apiSecret } = liveKitConfig();
  return Boolean(url && apiKey && apiSecret);
};

export interface LiveKitRoomToken {
  token: string;
  serviceUrl: string;
  expiresIn: number;
}

/**
 * Issue a LiveKit AccessToken scoped to a single room. Returns null when
 * LiveKit is not configured so callers can fall back to the legacy HMAC token.
 */
export const generateLiveKitRoomToken = async (params: {
  roomId: string;
  identity: string;
  name?: string;
  ttlSec?: number;
}): Promise<LiveKitRoomToken | null> => {
  const { url, apiKey, apiSecret } = liveKitConfig();
  if (!url || !apiKey || !apiSecret) return null;

  const expiresIn = params.ttlSec ?? 3600;

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.name,
    ttl: expiresIn,
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room: params.roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };
  accessToken.addGrant(grant);

  const token = await accessToken.toJwt();
  return { token, serviceUrl: url, expiresIn };
};
