import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { prisma } from "./prisma.js";

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
            const relabelProvider = user.authProvider === "PASSWORD";
            const activate = user.accountStatus === "PENDING_VERIFICATION";
            if (relabelProvider || activate) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: {
                  ...(relabelProvider ? { authProvider: "GOOGLE" } : {}),
                  ...(activate ? { accountStatus: "ACTIVE" } : {}),
                },
              });
            }
            return done(null, user);
          }

          user = await prisma.user.create({
            data: {
              fullName: profile.displayName ?? email.split("@")[0],
              email,
              authProvider: "GOOGLE",
              accountStatus: "ACTIVE",
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
            const relabelProvider = user.authProvider !== "FACEBOOK";
            const activate = user.accountStatus === "PENDING_VERIFICATION";
            if (relabelProvider || activate) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: {
                  ...(relabelProvider ? { authProvider: "FACEBOOK" } : {}),
                  ...(activate ? { accountStatus: "ACTIVE" } : {}),
                },
              });
            }
            return done(null, user);
          }

          user = await prisma.user.create({
            data: {
              fullName: profile.displayName ?? email.split("@")[0],
              email,
              authProvider: "FACEBOOK",
              accountStatus: "ACTIVE",
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
