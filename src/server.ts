import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { router as PasswordRoutes } from './routes/password.routes.js';
import passport from './config/passport.js';
import { router as OauthRoutes } from './routes/google-auth.routes.js';
import { sessionConfig } from './config/index.js';
import { setupSwagger } from './config/swagger.js';
import { router as FacebookRoutes } from './routes/facebook-auth.routes.js';
import { router as ImageUploadRoutes } from './routes/image-upload.route.js';
import { router as PaymentRoutes } from './routes/payment.routes.js';
import { router as TourRoutes } from './routes/tour.routes.js';
import { router as ProfileRoutes } from './routes/profile-routes.routes.js';
import { router as AdminRoutes } from './routes/admin.routes.js';
import { router as MessageRoutes } from './routes/message.routes.js';
import { deleteInactiveUsersJob } from './jobs/user-cleanup.js';
import { setupSocketHandlers } from './sockets/socketHandlers.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.API_URL || '*',
    credentials: true,
    methods: ['GET', 'POST']
  }
});

app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: process.env.API_URL || '*',
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(sessionConfig);
app.use(passport.initialize());
app.use(passport.session());

deleteInactiveUsersJob();
setupSwagger(app);

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

app.use('/auth', PasswordRoutes);
app.use('/auth', OauthRoutes);
app.use('/auth', FacebookRoutes);
app.use('/upload', ImageUploadRoutes);
app.use('/payment', PaymentRoutes);
app.use('/tours', TourRoutes);
app.use('/profile', ProfileRoutes);
app.use('/admin', AdminRoutes);
app.use('/api/messages', MessageRoutes);

app.use('/*path', (req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, error: `Endpoint '${req.params.path}' not found` });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

setupSocketHandlers(io);

export { server };
export default app;
