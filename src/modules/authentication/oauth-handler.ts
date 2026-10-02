import { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";
import { viewsPath } from "../../helpers/view-path.js";
import { resolveChannelAccessForLogin } from "../../services/community.service.js";
import {
  buildAppCallbackUrl,
  takeOAuthRedirect,
  verifyOAuthState,
  type OAuthProvider,
} from "./oauth-state.js";

interface OauthLoginOptions {
  provider: OAuthProvider;
  failurePath: string;
  successPath: string;
}

export async function finalizeOauthLogin(
  req: Request,
  res: Response,
  options: OauthLoginOptions,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.redirect(options.failurePath);
    return;
  }

  const queryState = typeof req.query?.state === "string" ? req.query.state : undefined;
  const bodyState = typeof req.body?.state === "string" ? req.body.state : undefined;
  const rawState = bodyState ?? queryState;

  const stateCheck = verifyOAuthState(req.session, rawState);
  if (!stateCheck.valid) {
    res.redirect(options.failurePath);
    return;
  }

  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    accountType: user.accountType,
  });

  const refreshToken: string = (await generateRefreshToken({
    id: user.id,
    email: user.email,
    accountType: user.accountType,
  }))!;

  if (stateCheck.redirect) {
    // The app is about to render a feed, and it needs to know whether to render
    // it locked — otherwise it flashes the locked state for a subscriber, or the
    // unlocked one for someone who cancelled.
    //
    // Forcing the check here, as on password login, is the point: this is a new
    // session, and the lease from the previous one is evidence about yesterday.
    // Best effort — a Google failure resolves to a locked snapshot rather than
    // blocking the sign-in.
    const communityAccess = await resolveChannelAccessForLogin(user.id);

    res.redirect(
      buildAppCallbackUrl(stateCheck.redirect, {
        accessToken,
        refreshToken,
        provider: options.provider,
        email: user.email,
        // A HINT, and deliberately only these two fields. A deep-link URL is
        // logged, screenshotted and readable by anything holding the link, so the
        // full snapshot does not belong in it. `accessVersion` travels because a
        // hint the app cannot order against a later API response is a way to
        // resurrect a stale verdict. The API stays authoritative: the app treats
        // this as what to draw first, and the community endpoint as the truth.
        accessVersion: String(communityAccess.accessVersion),
        hasChannelAccess: String(communityAccess.hasChannelAccess),
      }),
    );
    return;
  }

  setAuthCookies(res, accessToken, refreshToken);
  res.redirect(options.successPath);
}

export function handleOauthFailure(
  req: Request,
  res: Response,
  viewFile: string,
  retryPath: string,
): void {
  const redirect = takeOAuthRedirect(req.session);
  if (redirect) {
    res.redirect(buildAppCallbackUrl(redirect, { error: "OAuth authorization failed" }));
    return;
  }
  const template = readFileSync(viewsPath(viewFile), "utf8");
  const html = template.replace("{{RETRY_PATH}}", retryPath);
  res.status(401).type("html").send(html);
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
