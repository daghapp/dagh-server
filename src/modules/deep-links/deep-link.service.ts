import jwt from "jsonwebtoken";
import { prisma } from "../../config/index.js";

export type ShareType = "profile" | "event" | "post" | "app";

export interface DeepLinkTarget {
  type: ShareType;
  id: string;
}

export interface SmartLink {
  token: string;
  shareUrl: string;
  deepLink: string;
  deferredDeepLink: string;
  storeUrl: string;
  playStoreUrl: string;
  appStoreUrl: string;
  target: DeepLinkTarget;
}

const APP_SCHEME = (process.env.APP_DEEP_LINK_SCHEME || "diasporansync").trim();
const API_BASE_URL = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(
  /\/$/,
  "",
);
const PLAY_STORE_URL =
  process.env.PLAY_STORE_URL?.trim() ||
  "https://play.google.com/store/apps/details?id=com.simplymark.diasporansync";
const APP_STORE_URL = process.env.APP_STORE_URL?.trim() || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "deep-link-secret";

export function detectPlatform(userAgent: string): "android" | "ios" | "web" | "bot" {
  const ua = userAgent || "";
  if (
    /bot|crawler|spider|facebookexternalhit|whatsapp|twitterbot|slackbot|linkedinbot|telegrambot|googlebot/i.test(
      ua,
    )
  ) {
    return "bot";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

export function createDeepLinkToken(target: DeepLinkTarget, inviterId?: string): string {
  const payload = {
    type: target.type,
    id: target.id,
    inviterId: inviterId || null,
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "90d" });
}

export function verifyDeepLinkToken(
  token: string,
): (DeepLinkTarget & { inviterId?: string | null }) | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      type: ShareType;
      id: string;
      inviterId?: string | null;
    };
    if (!decoded?.type || !decoded?.id) return null;
    return { type: decoded.type, id: decoded.id, inviterId: decoded.inviterId };
  } catch {
    return null;
  }
}

export function buildStoreUrl(platform: "android" | "ios" | "web" | "bot", token: string): string {
  if (platform === "android") {
    const separator = PLAY_STORE_URL.includes("?") ? "&" : "?";
    return `${PLAY_STORE_URL}${separator}referrer=${encodeURIComponent(`token=${token}`)}`;
  }
  if (platform === "ios" && APP_STORE_URL) {
    const separator = APP_STORE_URL.includes("?") ? "&" : "?";
    return `${APP_STORE_URL}${separator}ct=diasporansync&pt=token-${encodeURIComponent(token)}`;
  }
  return APP_STORE_URL || PLAY_STORE_URL;
}

export function buildDeepLink(target: DeepLinkTarget, token?: string): string {
  const base = `${APP_SCHEME}://share/${target.type}/${encodeURIComponent(target.id)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function buildDeferredDeepLink(token: string): string {
  return `${APP_SCHEME}://deferred?token=${encodeURIComponent(token)}`;
}

export async function createSmartLink(params: {
  type: ShareType;
  id: string;
  inviterId?: string;
}): Promise<SmartLink> {
  const target: DeepLinkTarget = { type: params.type, id: params.id };
  const token = createDeepLinkToken(target, params.inviterId);
  const shareUrl = `${API_BASE_URL}/share/${params.type}/${encodeURIComponent(params.id)}?token=${encodeURIComponent(token)}`;
  return {
    token,
    shareUrl,
    deepLink: buildDeepLink(target, token),
    deferredDeepLink: buildDeferredDeepLink(token),
    storeUrl: buildStoreUrl("android", token),
    playStoreUrl: PLAY_STORE_URL,
    appStoreUrl: APP_STORE_URL,
    target,
  };
}

export async function resolveDeferredDeepLink(token: string): Promise<DeepLinkTarget | null> {
  const resolved = verifyDeepLinkToken(token);
  if (!resolved) return null;
  try {
    // Optional persistence hook (best effort).
    await (prisma as any).deferredDeepLink?.updateMany?.({
      where: { token },
      data: { claimedAt: new Date() },
    });
  } catch {
    // ignore
  }
  return { type: resolved.type, id: resolved.id };
}

export function getPlayStoreUrl(): string {
  return PLAY_STORE_URL;
}

export function getAppStoreUrl(): string {
  return APP_STORE_URL;
}

export function getAppScheme(): string {
  return APP_SCHEME;
}

// Aliases
export const generateSmartLink = createSmartLink;
export const generateDeepLink = createDeepLinkToken;
export const resolveDeepLink = resolveDeferredDeepLink;
export const resolveDeferredLink = resolveDeferredDeepLink;
export const claimDeferredDeepLink = resolveDeferredDeepLink;

export const createDeepLink = createDeepLinkToken;
export const resolveToken = resolveDeferredDeepLink;
export const resolveDeepLinkToken = resolveDeferredDeepLink;
export const getDeferredDeepLink = resolveDeferredDeepLink;
export const parseDeepLinkToken = verifyDeepLinkToken;
