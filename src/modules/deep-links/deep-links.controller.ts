import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as deepLinkService from "./deep-link.service.js";

export class DeepLinksController {
  async create(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return fail(res, 401, "Unauthorized");
      const { type, id } = req.body || {};
      if (!type || !id || !["profile", "event", "post", "app"].includes(type)) {
        return fail(res, 400, "Invalid type or id");
      }
      const link = await deepLinkService.createSmartLink({ type, id, inviterId: userId });
      return ok(res, link, "Smart link created");
    } catch (error) {
      console.error("[deep-links.create]", error);
      return fail(res, 500, "Failed to create smart link");
    }
  }

  async resolve(req: Request, res: Response) {
    try {
      const token = String(req.query.token || req.params.token || req.body?.token || "");
      if (!token) return fail(res, 400, "token is required");
      const target = await deepLinkService.resolveDeferredDeepLink(token);
      if (!target) return fail(res, 404, "Invalid or expired token");
      return ok(res, { target, deepLink: deepLinkService.buildDeepLink(target, token) });
    } catch (error) {
      console.error("[deep-links.resolve]", error);
      return fail(res, 500, "Failed to resolve deep link");
    }
  }

  async claim(req: Request, res: Response) {
    return this.resolve(req, res);
  }

  async redirect(req: Request, res: Response) {
    try {
      const type = String(req.params.type);
      const id = String(req.params.id);
      if (!["profile", "event", "post", "app"].includes(type)) return fail(res, 404, "Not found");
      const ua = req.headers["user-agent"] || "";
      const platform = deepLinkService.detectPlatform(ua);
      const token = String(req.query.token || "");
      const deepLink = deepLinkService.buildDeepLink({ type: type as any, id }, token || undefined);
      const storeUrl = token
        ? deepLinkService.buildStoreUrl(platform === "ios" ? "ios" : "android", token)
        : (platform === "ios" ? deepLinkService.getAppStoreUrl() : deepLinkService.getPlayStoreUrl());
      if (platform === "bot") {
        return res.redirect(302, `${process.env.API_URL || ""}/share/${type}/${id}`);
      }
      // Try deep link then store fallback via HTML.
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Open</title>
<script>
(function(){
  var deepLink=${JSON.stringify(deepLink)};
  var storeUrl=${JSON.stringify(storeUrl || "")};
  var started=Date.now();
  window.location.href=deepLink;
  setTimeout(function(){ if(Date.now()-started<1600 && storeUrl){ window.location.replace(storeUrl);} },1500);
})();
</script></head><body><a href="${deepLink}">Open</a> ${storeUrl ? `<a href="${storeUrl}">Download</a>` : ""}</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (error) {
      console.error("[deep-links.redirect]", error);
      return fail(res, 500, "Failed");
    }
  }
}

export const deepLinksController = new DeepLinksController();
