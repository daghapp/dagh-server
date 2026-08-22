import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import AppleStrategy from "passport-apple";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import type { Request } from "express";

const {
  CLIENTID,
  CLIENTSECRETE,
  REDIRECTURI,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FACEBOOK_CALLBACK_URL,
  APPLE_CLIENT_ID,
  APPLE_TEAM_ID,
  APPLE_KEY_ID,
  APPLE_PRIVATE_KEY_PATH,
  APPLE_CALLBACK_URL,
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
if (
  APPLE_CLIENT_ID &&
  APPLE_TEAM_ID &&
  APPLE_KEY_ID &&
  APPLE_PRIVATE_KEY_PATH &&
  APPLE_CALLBACK_URL
) {
  passport.use(
    // @ts-expect-error — passport-apple has no TypeScript types; callback signature differs from OAuth2Strategy
    new AppleStrategy(
      {
        clientID: APPLE_CLIENT_ID,
        teamID: APPLE_TEAM_ID,
        keyID: APPLE_KEY_ID,
        privateKeyLocation: APPLE_PRIVATE_KEY_PATH,
        callbackURL: APPLE_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (
        req: Request,
        _accessToken: string,
        _refreshToken: string,
        idToken: string,
        _profile: unknown,
        done: (err: Error | null, user?: Express.User | false) => void,
      ) => {
        try {
          // Decode the id_token JWT to get user info
          const decoded = jwt.decode(idToken) as Record<string, unknown> | null;
          if (!decoded || typeof decoded.sub !== "string") {
            return done(new Error("No valid id_token from Apple"), false);
          }

          const email = typeof decoded.email === "string" ? decoded.email : undefined;

          // Apple may not provide email if user chose to hide it
          // In that case, we need to handle the case where email is undefined
          // The user profile may be in req.body.user (JSON string)
          let fullName: string | undefined;
          if (req.body && req.body.user) {
            const userProfile = JSON.parse(req.body.user);
            fullName = userProfile.name
              ? `${userProfile.name.firstName || ""} ${userProfile.name.lastName || ""}`.trim()
              : undefined;
          }

          // Try to find user by email first, then by appleId
          let user = email
            ? await prisma.user.findUnique({ where: { email } })
            : await prisma.user.findFirst({ where: { authProvider: "ICLOUD" } });

          if (user) {
            // Update auth provider if it was PASSWORD
            if (user.authProvider === "PASSWORD") {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { authProvider: "ICLOUD" },
              });
            }
            return done(null, user);
          }

          // Create new user
          if (!email) {
            return done(new Error("No email provided by Apple"), false);
          }

          user = await prisma.user.create({
            data: {
              fullName: fullName || email.split("@")[0],
              email,
              authProvider: "ICLOUD",
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
