import { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import {
  IMAGE_PROXY_CACHE_DIR,
  IMAGE_PROXY_CACHE_TTL_MS,
  PLACEHOLDER_SVG,
  ensureImageProxyCacheDir,
  imageProxyCacheKey,
  isAllowedImageHost,
} from "../../helpers/image-proxy.js";

const MAX_WIDTH = 3840;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

function clampWidth(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 800;
  return Math.min(Math.max(Math.round(parsed), 1), MAX_WIDTH);
}

function sendPlaceholder(res: Response): void {
  res.status(200);
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "public, max-age=300");
  res.send(PLACEHOLDER_SVG);
}

async function fetchAllowedImage(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<globalThis.Response> {
  // Follow redirects manually so an allowed host cannot bounce the proxy to an
  // internal address (SSRF). Wikimedia and similar hosts legitimately redirect
  // between their own subdomains, so allow additional hops only when the new
  // host is also on the allow list.
  let currentUrl = new URL(sourceUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
      throw new Error(`Unsupported image protocol: ${currentUrl.protocol}`);
    }
    if (!isAllowedImageHost(currentUrl.hostname)) {
      throw new Error(`Image host not allowed: ${currentUrl.hostname}`);
    }

    // Wikimedia's map renderer rejects requests without a user agent and
    // referer, so send both for every upstream (they are ignored by the photo
    // hosts and harmless there).
    const response = await fetch(currentUrl, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "DAGH-Image-Proxy/1.0 (tour catalogue images)",
        Referer: "https://www.wikipedia.org/",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response without a Location header");
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return response;
  }

  throw new Error("Too many image proxy redirects");
}

interface CacheMeta {
  contentType: string;
  sourceUrl: string;
  width: number;
  createdAt: number;
}

export class ImageProxyController {
  async proxy(req: Request, res: Response): Promise<void> {
    const sourceUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    const width = clampWidth(req.query.w);

    if (!sourceUrl) {
      sendPlaceholder(res);
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      sendPlaceholder(res);
      return;
    }

    if (!isAllowedImageHost(parsed.hostname)) {
      sendPlaceholder(res);
      return;
    }

    const key = imageProxyCacheKey(sourceUrl, width);
    const cachePath = path.join(IMAGE_PROXY_CACHE_DIR, key);
    const metaPath = `${cachePath}.json`;

    try {
      await ensureImageProxyCacheDir();
      const stat = await fs.stat(cachePath).catch(() => null);
      const metaRaw = await fs.readFile(metaPath, "utf8").catch(() => null);
      if (stat && metaRaw) {
        const meta = JSON.parse(metaRaw) as CacheMeta;
        const age = Date.now() - (meta.createdAt || stat.mtimeMs);
        if (age < IMAGE_PROXY_CACHE_TTL_MS) {
          const buffer = await fs.readFile(cachePath);
          res.status(200);
          res.set("Content-Type", meta.contentType || "application/octet-stream");
          res.set("Cache-Control", "public, max-age=86400, immutable");
          res.set("X-Image-Proxy", "HIT");
          res.send(buffer);
          return;
        }
      }
    } catch {
      // Ignore cache read errors and refetch.
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const upstream = await fetchAllowedImage(sourceUrl, controller.signal);
      if (!upstream.ok) throw new Error(`upstream status ${upstream.status}`);
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await upstream.arrayBuffer());

      const meta: CacheMeta = {
        contentType,
        sourceUrl,
        width,
        createdAt: Date.now(),
      };
      await fs.writeFile(cachePath, buffer);
      await fs.writeFile(metaPath, JSON.stringify(meta));

      res.status(200);
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400, immutable");
      res.set("X-Image-Proxy", "MISS");
      res.send(buffer);
    } catch {
      sendPlaceholder(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  placeholder(_req: Request, res: Response): void {
    sendPlaceholder(res);
  }
}
