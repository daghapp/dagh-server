import express from 'express';
import dotenv from 'dotenv';
import { router as PasswordRoutes } from './routes/password.routes.js';
import passport from './config/passport.js';
import{router as OauthRoutes} from './routes/google-auth.routes.js'
import { sessionConfig } from './config/index.js';
import { setupSwagger } from './config/swagger.js';
import cors from 'cors';
import{router as FacebookRoutes} from './routes/facebook-auth.routes.js'
import { router as ImageUploadRoutes } from './routes/image-upload.route.js';
import { router as PaymentRoutes } from './routes/payment.routes.js';
import { router as TourRoutes } from './routes/tour.routes.js';
import {router as ProfileRoutes} from './routes/profile-routes.routes.js'
import { router as AdminRoutes } from './routes/admin.routes.js';
import { deleteInactiveUsersJob } from './jobs/user-cleanup.js';

dotenv.config();

const app = express();


app.use(express.json());

app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(sessionConfig);

app.use(passport.initialize());
app.use(passport.session());

// Initialize cron jobs
deleteInactiveUsersJob();

// Setup Swagger
setupSwagger(app);



//user authentication routes
app.use('/auth', PasswordRoutes);
app.use('/auth', OauthRoutes);
app.use('/auth', FacebookRoutes);

//image upload route
app.use('/images', ImageUploadRoutes);

//payment routes
app.use('/payment', PaymentRoutes);

//tour management routes
app.use('/tours', TourRoutes);

app.use('/profile', ProfileRoutes);

// Admin routes
app.use("/admin", AdminRoutes);






export default app