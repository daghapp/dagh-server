import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { router as PasswordRoutes } from "./routes/password.routes.js";
import passport from "./config/passport.js";
import { router as OauthRoutes } from "./routes/google-auth.routes.js";
import { sessionConfig } from "./config/index.js";
import { setupSwagger } from "./config/swagger.js";
import { router as FacebookRoutes } from "./routes/facebook-auth.routes.js";
import { router as AppleRoutes } from "./routes/apple-auth.routes.js";
import { router as ImageUploadRoutes } from "./routes/image-upload.route.js";
import { router as PaymentRoutes } from "./routes/payment.routes.js";
import { router as TourRoutes } from "./routes/tour.routes.js";
import { router as ProfileRoutes } from "./routes/profile-routes.routes.js";
import { router as VerificationRoutes } from "./routes/verification.routes.js";

import { router as AdminRoutes } from "./routes/admin.routes.js";
import { router as AdminProfileRoutes } from "./routes/admin-profile-routes.js";
import { router as VisaRoutes } from "./routes/visa.routes.js";
import { router as ItineraryGenRoutes } from "./routes/itinerary.routes.js";
import { router as ProviderRoutes } from "./routes/provider.routes.js";
import { router as ProfileValidationStepRoutes } from "./routes/profile-validation-step.routes.js";
import { router as ProfileEthnicityRoutes } from "./routes/profile-ethnicity.routes.js";
import { router as MessageRoutes } from "./routes/message.routes.js";
import { router as CallsRoutes } from "./routes/calls.routes.js";
// Phase 3.1 — Membership Plans & Tiers
import { router as MembershipRoutes } from "./routes/membership.routes.js";
// Dating module
import { router as DatingRoutes } from "./routes/dating.routes.js";

import { deleteInactiveUsersJob } from "./jobs/user-cleanup.js";
import { setupSocketHandlers } from "./sockets/socketHandlers.js";
import { checkPendingPaymentsJob } from "./jobs/check-pending-payments.js";
import { setIoInstance } from "./modules/messages/messages.controller.js";
import { setIoInstance as setDatingIoInstance } from "./modules/dating/swipe.controller.js";
import { fail } from "./helpers/response.js"; // Phase 3.4 — standardized response helpers

dotenv.config();

const app = express();
const server = http.createServer(app);

// Phase 1.2 — CORS tightened: require ALLOWED_ORIGINS env var (no wildcard fallback).
// Previously used `process.env.API_URL || '*'` which opened the API to any origin.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(sessionConfig);
app.use(passport.initialize());
app.use(passport.session());

deleteInactiveUsersJob();
checkPendingPaymentsJob();
setupSwagger(app);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the current status, uptime, and timestamp of the server
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                   example: 12345.678
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: 2026-05-04T10:00:00Z
 */
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

app.use("/auth", authLimiter, PasswordRoutes);
app.use("/auth", authLimiter, OauthRoutes);
app.use("/auth", authLimiter, FacebookRoutes);
app.use("/auth", authLimiter, AppleRoutes);
app.use("/upload", ImageUploadRoutes);
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, error: "Too many payment requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/payment", paymentLimiter, PaymentRoutes);
app.use("/tours", TourRoutes);
app.use("/profile", ProfileRoutes);
app.use("/verification", VerificationRoutes);
app.use("/verification", ProfileValidationStepRoutes);
app.use("/profile", ProfileEthnicityRoutes);

app.use("/admin", AdminRoutes);
app.use("/admin", AdminProfileRoutes);

app.use("/visa-requests", VisaRoutes);

app.use("/itinerary", ItineraryGenRoutes);
app.use("/providers", ProviderRoutes);
// Phase 2.1 — Message routes wired up (previously registered but never connected to Socket.IO)
app.use("/messages", MessageRoutes);
app.use("/calls", CallsRoutes);
// Phase 3.1 — Membership Plans & Tiers
app.use("/membership", MembershipRoutes);
// Dating module
app.use("/dating", DatingRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "DAGH API",
    version: "1.0.0",
    status: "OK",
    health: "/health",
    docs: "/api-docs",
    timestamp: new Date(),
  });
});

// Express 5 catch-all: "/{*splat}" matches every path including the root "/"
// (the previous "/*path" only matched paths with at least one segment).
app.use("/{*splat}", (req: express.Request, res: express.Response) => {
  const path = req.params.splat;
  const displayPath = Array.isArray(path) ? path.join("/") : (path ?? "");
  fail(res, 404, `Endpoint '/${displayPath}' not found`);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  fail(res, 500, "Internal server error");
});

setupSocketHandlers(io);
// Phase 2.1 — Inject Socket.IO instance into messages controller so it can emit real-time events
setIoInstance(io);
// Dating module — inject Socket.IO instance for match events
setDatingIoInstance(io);

export { server };
export default app;
