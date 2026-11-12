import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ALLOWED_IMAGE_HOSTS = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
  "images.unsplash.com",
  "places.googleapis.com",
  "res.cloudinary.com",
]);

export function isAllowedImageHost(host: string): boolean {
  return ALLOWED_IMAGE_HOSTS.has(host.toLowerCase());
}

export function getProxyBaseUrl(): string {
  const base = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
  return base.replace(/\/+$/, "");
}

export function buildImageProxyUrl(sourceUrl: string, width = 800): string {
  if (!sourceUrl) return sourceUrl;
  const params = new URLSearchParams({ url: sourceUrl, w: String(width) });
  return `${getProxyBaseUrl()}/media/images?${params.toString()}`;
}

export const IMAGE_PROXY_CACHE_TTL_MS = Number(
  process.env.IMAGE_PROXY_CACHE_TTL_MS || 24 * 60 * 60 * 1000,
);
export const IMAGE_PROXY_CACHE_DIR =
  process.env.IMAGE_PROXY_CACHE_DIR || path.join(os.tmpdir(), "dagh-image-proxy");

export function imageProxyCacheKey(sourceUrl: string, width: number): string {
  return crypto.createHash("sha256").update(`${sourceUrl}|${width}`).digest("hex");
}

export async function ensureImageProxyCacheDir(): Promise<void> {
  await fs.mkdir(IMAGE_PROXY_CACHE_DIR, { recursive: true });
}

export function resolveImageUrl(
  candidates: Array<string | null | undefined>,
  width = 800,
): string | null {
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="Image unavailable"><rect width="800" height="600" fill="#e5e7eb"/><g fill="#9ca3af" font-family="sans-serif" font-size="28" text-anchor="middle"><text x="400" y="300">Image unavailable</text></g></svg>`;
