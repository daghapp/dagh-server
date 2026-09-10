import { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";
import { viewsPath } from "../../helpers/view-path.js";
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
    res.redirect(
      buildAppCallbackUrl(stateCheck.redirect, {
        accessToken,
        refreshToken,
        provider: options.provider,
        email: user.email,
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
