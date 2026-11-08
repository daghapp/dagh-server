import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

const PLAY_STORE_URL =
  process.env.PLAY_STORE_URL?.trim() || "https://play.google.com/store/apps/details?id=com.simplymark.diasporansync";
const APP_STORE_URL = process.env.APP_STORE_URL?.trim() || "";
const APP_SCHEME = process.env.APP_DEEP_LINK_SCHEME?.trim() || "diasporansync";
const API_BASE_URL = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

type ShareType = "profile" | "event" | "post";

interface ShareMeta {
  type: ShareType;
  id: string;
  title: string;
  description: string;
  image: string | null;
  url: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isBot(userAgent: string): boolean {
  return /bot|crawler|spider|facebookexternalhit|whatsapp|twitterbot|slackbot|linkedinbot|telegrambot|googlebot/i.test(
    userAgent,
  );
}

async function fetchMeta(type: ShareType, id: string): Promise<ShareMeta | null> {
  const base = API_BASE_URL || "";
  const url = `${base}/share/${type}/${encodeURIComponent(id)}`;
  if (type === "profile") {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, username: true, profileImageUrl: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== "ACTIVE") return null;
    const name = user.fullName || user.username || "Diaspora Sync member";
    return {
      type,
      id: user.id,
      title: `${name} on Diaspora Sync`,
      description: `View ${name}'s profile on Diaspora Sync.`,
      image: user.profileImageUrl || null,
      url,
    };
  }
  if (type === "post") {
    const video = await prisma.communityVideo.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, thumbnailUrl: true, isPublished: true },
    });
    if (!video || !video.isPublished) return null;
    return {
      type,
      id: video.id,
      title: video.title,
      description: video.description || "Community post on Diaspora Sync",
      image: video.thumbnailUrl || null,
      url,
    };
  }
  if (type === "event") {
    const tour = await prisma.tour_packages.findUnique({
      where: { id },
      select: { id: true, title: true, shortDescription: true, description: true, coverImage: true },
    });
    if (!tour) return null;
    return {
      type,
      id: tour.id,
      title: tour.title || "Group event on Diaspora Sync",
      description: tour.shortDescription || tour.description || "Group event on Diaspora Sync",
      image: tour.coverImage || null,
      url,
    };
  }
  return null;
}

function renderHtml(meta: ShareMeta, userAgent: string): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = meta.image ? escapeHtml(meta.image) : "";
  const url = escapeHtml(meta.url);
  const deepLink = `${APP_SCHEME}://share/${meta.type}/${meta.id}`;
  const storeUrl = /iPhone|iPad|iPod/i.test(userAgent) ? APP_STORE_URL : PLAY_STORE_URL;
  const bot = isBot(userAgent);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${image ? `<meta property="og:image" content="${image}">` : ""}
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${image}">` : ""}
${!bot ? `<script>
(function(){
  var deepLink = ${JSON.stringify(deepLink)};
  var storeUrl = ${JSON.stringify(storeUrl || "")};
  var started = Date.now();
  window.location.href = deepLink;
  setTimeout(function(){
    if (Date.now() - started < 1600) {
      if (storeUrl) window.location.replace(storeUrl);
    }
  }, 1500);
})();
</script>` : ""}
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
${image ? `<img src="${image}" alt="${title}" style="max-width:100%">` : ""}
<p><a href="${escapeHtml(deepLink)}">Open in app</a></p>
${storeUrl ? `<p><a href="${escapeHtml(storeUrl)}">Download the app</a></p>` : ""}
</body>
</html>`;
}

export class ShareController {
  async preview(req: Request, res: Response) {
    const type = String(req.params.type) as ShareType;
    const id = String(req.params.id);
    if (!["profile", "event", "post"].includes(type)) {
      return fail(res, 404, "Not found");
    }
    try {
      const meta = await fetchMeta(type as ShareType, id);
      if (!meta) return fail(res, 404, "Not found");
      const html = renderHtml(meta, req.headers["user-agent"] || "");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).send(html);
    } catch (error) {
      console.error("[share.preview]", error);
      return fail(res, 500, "Failed to render preview");
    }
  }

  async createLink(req: Request, res: Response) {
    const userId = req.user?.id as string;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { type, id } = req.body as { type?: ShareType; id?: string };
    if (!type || !id || !["profile", "event", "post"].includes(type)) {
      return fail(res, 400, "Invalid type or id");
    }
    const meta = await fetchMeta(type, id);
    if (!meta) return fail(res, 404, "Not found");
    return ok(res, { shareUrl: meta.url, title: meta.title, imageUrl: meta.image });
  }
}
