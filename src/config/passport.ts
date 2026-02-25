import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
<<<<<<< HEAD
=======
import { Strategy as FacebookStrategy } from "passport-facebook";
>>>>>>> fixcors
import { prisma } from "./prisma.js";

const { CLIENTID, CLIENTSECRETE, REDIRECTURI, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_CALLBACK_URL } = process.env;

if (!CLIENTID || !CLIENTSECRETE || !REDIRECTURI) {
  throw new Error("Google OAuth env vars missing");
}

passport.use(
  new GoogleStrategy(
    {
      clientID: CLIENTID,
      clientSecret: CLIENTSECRETE,
      callbackURL: REDIRECTURI,
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
        done(err, false);
      }
    }
  )
);

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
      }
    )
  );
}

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err, false);
  }
});

export default passport;
