import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "./prisma";
const { CLIENTID, CLIENTSECRETE, REDIRECTURI } = process.env;
if (!CLIENTID || !CLIENTSECRETE || !REDIRECTURI) {
    throw new Error("Google OAuth env vars missing");
}
passport.use(new GoogleStrategy({
    clientID: CLIENTID,
    clientSecret: CLIENTSECRETE,
    callbackURL: REDIRECTURI,
}, async (_accessToken, _refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value;
        if (!email)
            return done(new Error("No email from Google"), false);
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
    }
    catch (err) {
        done(err, false);
    }
}));
passport.serializeUser((user, done) => {
    done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    }
    catch (err) {
        done(err, false);
    }
});
export default passport;
