import express from 'express';
import dotenv from 'dotenv';
import { router as PasswordRoutes } from './routes/password.routes';
import passport from './config/passport';
import { router as OauthRoutes } from './routes/google-auth.routes';
import { sessionConfig } from './config';
import { setupSwagger } from './config/swagger';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(sessionConfig);
app.use(passport.initialize());
app.use(passport.session());
// Setup Swagger
setupSwagger(app);
app.get('/', (req, res) => {
    res.send('Hello, World!');
});
//user authentication routes
app.use('/auth', PasswordRoutes);
app.use('/auth', OauthRoutes);
app.get("/profile", (req, res) => {
    if (!req.user) {
        return res.redirect("/");
    }
    res.send(`<h1>Profile Page</h1><p>Welcome ${req.user}</p>`);
});
export default app;
