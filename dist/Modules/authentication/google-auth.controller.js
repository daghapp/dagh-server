import { generateAccessToken, generateRefreshToken } from "src/helpers/index";
export class GoogleAuthController {
    async googleAuthCallback(req, res) {
        try {
            const user = req.user;
            if (!user) {
                return res.redirect("/auth/google/failed");
            }
            const accessToken = generateAccessToken({
                id: user.id,
                email: user.email,
                accountType: user.role,
            });
            const refreshToken = await generateRefreshToken({
                id: user.id,
                email: user.email,
                accountType: user.role,
            });
            // Redirect to success page with tokens in query params
            res.redirect(`/auth/google/success?email=${encodeURIComponent(user.email)}&accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`);
        }
        catch {
            res.redirect("/auth/google/failed");
        }
    }
}
