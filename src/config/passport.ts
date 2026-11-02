import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import AppleStrategy from "passport-apple";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { getAppleSignInConfig } from "./apple.js";
import {
  isAppleIdTokenPayloadValid,
  resolveAppleUser,
} from "../modules/authentication/apple-identity.js";
import { storeAppleRefreshToken } from "../services/apple-token.service.js";
import type { Request } from "express";

const {
  CLIENTID,
  CLIENTSECRETE,
  REDIRECTURI,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FACEBOOK_CALLBACK_URL,
} = process.env;

// Google OAuth Strategy (registered only when credentials are configured,
// so tests/CI can run without OAuth env vars)
if (CLIENTID && CLIENTSECRETE && REDIRECTURI) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: CLIENTID,
        clientSecret: CLIENTSECRETE,
        callbackURL: REDIRECTURI || "http://localhost:3000/auth/google/callback",
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("No email from Google"), false);

          let user = await prisma.user.findUnique({ where: { email } });

          if (user) {
            if (user.authProvider === "PASSWORD") {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { authProvider: "GOOGLE" },
              });
            }
            return done(null, user);
          }

          user = await prisma.user.create({
            data: {
              fullName: profile.displayName ?? email.split("@")[0],
              email,
              authProvider: "GOOGLE",
            },
          });

          done(null, user);
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)), false);
        }
      },
    ),
  );
}

// Facebook Strategy
if (FACEBOOK_APP_ID && FACEBOOK_APP_SECRET && FACEBOOK_CALLBACK_URL) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: FACEBOOK_APP_ID,
        clientSecret: FACEBOOK_APP_SECRET,
        callbackURL: FACEBOOK_CALLBACK_URL,
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("No email from Facebook"), false);

          let user = await prisma.user.findUnique({ where: { email } });

          if (user) {
            if (user.authProvider !== "FACEBOOK") {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { authProvider: "FACEBOOK" },
              });
            }
            return done(null, user);
          }

          user = await prisma.user.create({
            data: {
              fullName: profile.displayName ?? email.split("@")[0],
              email,
              authProvider: "FACEBOOK",
            },
          });

          done(null, user);
        } catch (err) {
          done(err, false);
        }
      },
    ),
  );
}

// Apple Sign In Strategy
const appleConfig = getAppleSignInConfig();
if (appleConfig) {
  passport.use(
    // @ts-expect-error — passport-apple has no TypeScript types; callback signature differs from OAuth2Strategy
    new AppleStrategy(
      {
        clientID: appleConfig.clientID,
        teamID: appleConfig.teamID,
        keyID: appleConfig.keyID,
        ...(appleConfig.privateKeyString
          ? { privateKeyString: appleConfig.privateKeyString }
          : { privateKeyLocation: appleConfig.privateKeyLocation }),
        callbackURL: appleConfig.callbackURL,
        passReqToCallback: true,
      },
      async (
        req: Request,
        _accessToken: string,
        refreshToken: string,
        idToken: string,
        _profile: unknown,
        done: (err: Error | null, user?: Express.User | false) => void,
      ) => {
        try {
          // The id_token comes directly from Apple's token endpoint over TLS.
          // Decode it for the stable `sub` claim and optional profile fields.
          const decoded = jwt.decode(idToken) as Record<string, unknown> | null;
          if (
            !decoded ||
            typeof decoded.sub !== "string" ||
            !isAppleIdTokenPayloadValid(decoded, appleConfig.clientID)
          ) {
            return done(new Error("No valid id_token from Apple"), false);
          }

          const email = typeof decoded.email === "string" ? decoded.email : undefined;

          // Apple only sends the user's name on first authorization, inside the
          // form-posted `user` field.
          let fullName: string | undefined;
          if (req.body?.user) {
            const userProfile = JSON.parse(req.body.user);
            fullName = userProfile.name
              ? `${userProfile.name.firstName || ""} ${userProfile.name.lastName || ""}`.trim()
              : undefined;
          }

          const user = await resolveAppleUser({
            appleId: decoded.sub,
            email,
            fullName,
          });

          // Retained only for revocation when the user later deletes the
          // account. A storage failure must not block sign-in.
          if (refreshToken) {
            try {
              await storeAppleRefreshToken(user.id, refreshToken);
            } catch (error) {
              console.error(
                "[apple] failed to store refresh token for revocation:",
                error instanceof Error ? error.message : error,
              );
            }
          }

          done(null, user);
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)), false);
        }
      },
    ),
  );
}

passport.serializeUser((user: Express.User, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err instanceof Error ? err : new Error(String(err)), false);
  }
});

export default passport;
