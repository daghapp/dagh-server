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

dotenv.config();

const app = express();


app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
  })
);

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
app.use('/auth', FacebookRoutes);

//image upload route
app.use('/images', ImageUploadRoutes);

//payment routes
app.use('/payment', PaymentRoutes);


app.get("/profile", (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }

  res.send(`<h1>Profile Page</h1><p>Welcome ${req.user}</p>`);
});






export default app