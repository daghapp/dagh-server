import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { createAdapter } from "@socket.io/redis-adapter";
import { connectRedis, getRedisPubClient, getRedisSubClient } from "./config/redis.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import requestId from "./middleware/request-id.js";
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
import { router as AdminAuthRoutes } from "./routes/admin-auth.routes.js";
import { router as AdminConsoleRoutes } from "./routes/admin-console.routes.js";
import { router as AdminProfileRoutes } from "./routes/admin-profile.routes.js";
import { router as AdminPaymentGatewayRoutes } from "./routes/admin-payment-gateway.routes.js";
import { router as VisaRoutes } from "./routes/visa.routes.js";
import { router as ItineraryGenRoutes } from "./routes/itinerary.routes.js";
import { router as ProviderRoutes } from "./routes/provider.routes.js";
import { router as ProfileValidationStepRoutes } from "./routes/profile-validation-step.routes.js";
import { router as ProfileEthnicityRoutes } from "./routes/profile-ethnicity.routes.js";
import { router as MessageRoutes } from "./routes/message.routes.js";
import { router as CallsRoutes } from "./routes/calls.routes.js";
import { router as DevicesRoutes } from "./routes/devices.routes.js";
// Phase 3.1 — Membership Plans & Tiers
import { router as MembershipRoutes } from "./routes/membership.routes.js";
// Dating module
import { router as DatingRoutes } from "./routes/dating.routes.js";
import { router as GeoRoutes } from "./routes/geo.routes.js";
import { router as DataPolicyRoutes } from "./routes/data-policy.routes.js";
import { router as FaqRoutes } from "./routes/faq.routes.js";
// Community video feed (YouTube funnel)
import { router as CommunityRoutes } from "./routes/community.routes.js";

import { deleteInactiveUsersJob } from "./jobs/user-cleanup.js";
import { callExpiryJob, setCallExpiryIo } from "./jobs/call-expiry.js";
import { pushDeliveryJob } from "./jobs/push-delivery.js";
import { setupSocketHandlers } from "./sockets/socketHandlers.js";
import { checkPendingPaymentsJob } from "./jobs/check-pending-payments.js";
import { subscriptionExpiryJob } from "./jobs/subscription-expiry.js";
import { channelGrantReverifyJob } from "./jobs/channel-grant-reverify.js";
import { logYouTubeGateStatus } from "./services/youtube-oauth.service.js";
import { setIoInstance } from "./modules/messages/messages.controller.js";
import { setIoInstance as setCallIoInstance } from "./modules/messages/calls.controller.js";
import { setIoInstance as setDatingIoInstance } from "./modules/dating/swipe.controller.js";
import { initFirebase } from "./config/firebase.js";
import { initApns } from "./config/apns.js";
import { fail } from "./helpers/response.js"; // Phase 3.4 — standardized response helpers

dotenv.config();

// Connect Redis before the Socket.IO adapter / rate limiters are set up. Falls
// back to single-instance behavior when REDIS_URL is not configured.
await connectRedis();

const app = express();
const server = http.createServer(app);

// Trust the first proxy hop (Render/Cloudflare) so express-rate-limit keys on the
// real client IP instead of ::1 and stops logging ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

// Phase 1.2 — CORS tightened: require ALLOWED_ORIGINS env var (no wildcard fallback).
// Previously used `process.env.API_URL || '*'` which opened the API to any origin.
// The API's own public origin is always allowed so the Swagger UI served by this
// server keeps working even if ALLOWED_ORIGINS is missing on the host.
const allowedOrigins = Array.from(
  new Set(
    [
      ...(process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
        : []),
      process.env.RENDER_EXTERNAL_URL,
      process.env.API_URL,
    ].filter((o): o is string => Boolean(o)),
  ),
);

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

// Shared pub/sub adapter so messages, presence, and call signaling fan out
// across all instances instead of only the process the socket is connected to.
const redisPub = getRedisPubClient();
const redisSub = getRedisSubClient();
if (redisPub && redisSub) {
  io.adapter(createAdapter(redisPub, redisSub));
  console.log("[socket.io] Redis adapter enabled");
}

const authLimiter = createRateLimiter("auth", 15 * 60 * 1000, {
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
// Correlation id for every request: echoed as X-Request-Id and recorded on audit
// rows. Must come before morgan so the id is available to request-scoped logging.
app.use(requestId);
app.use(express.json());
// urlencoded body parsing for the Apple Sign In callback (response_mode=form_post),
// which posts its auth code/state as application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: true }));
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
subscriptionExpiryJob();
channelGrantReverifyJob();
logYouTubeGateStatus();
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
const paymentLimiter = createRateLimiter("payment", 15 * 60 * 1000, {
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
app.use("/admin", AdminAuthRoutes);
app.use("/admin", AdminConsoleRoutes);
app.use("/admin", AdminProfileRoutes);
app.use("/admin", AdminPaymentGatewayRoutes);

app.use("/visa-requests", VisaRoutes);

app.use("/itinerary", ItineraryGenRoutes);
app.use("/providers", ProviderRoutes);
// Phase 2.1 — Message routes wired up (previously registered but never connected to Socket.IO)
app.use("/messages", MessageRoutes);
app.use("/calls", CallsRoutes);
app.use("/devices", DevicesRoutes);
// Phase 3.1 — Membership Plans & Tiers
app.use("/membership", MembershipRoutes);
// Dating module
app.use("/dating", DatingRoutes);
// Jurisdiction / geo-IP check
app.use("/geo", GeoRoutes);
// Data policy (public read + admin edit)
app.use("/data-policy", DataPolicyRoutes);
// FAQ (public read + admin CRUD)
app.use("/faq", FaqRoutes);
// Community video feed (YouTube subscribe funnel + analytics)
app.use("/community", CommunityRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "Diaspora Sync API",
    version: "1.0.0",
    status: "OK",
    health: "/health",
    docs: "/api-docs",
    timestamp: new Date(),
  });
});

// Express 5 catch-all: "/{*splat}" matches every path including the root "/"
// /sentry-debug - throw an intentional error to verify Sentry captures events.
/**
 * @swagger
 * /sentry-debug:
 *   get:
 *     summary: Trigger a test error to verify Sentry is capturing events
 *     tags: [System]
 *     responses:
 *       500:
 *         description: The intentionally thrown error
 */
app.get("/sentry-debug", () => {
  throw new Error("Sentry test error - this is intentional");
});

// (the previous "/*path" only matched paths with at least one segment).
app.use("/{*splat}", (req: express.Request, res: express.Response) => {
  const path = req.params.splat;
  const displayPath = Array.isArray(path) ? path.join("/") : (path ?? "");
  fail(res, 404, `Endpoint '/${displayPath}' not found`);
});

// Capture unhandled errors with Sentry before responding. Registered after all
// controllers so route errors are reported; our custom error middleware below
// still handles the response. Skipped when Sentry is disabled (no SENTRY_DSN).
if (Sentry.getClient()) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.message === "Not allowed by CORS") {
    fail(
      res,
      403,
      `Origin not allowed by CORS. Add it to ALLOWED_ORIGINS (or no Origin header for native clients)`,
    );
    return;
  }
  const bodyError = err as Error & { status?: number; type?: string };
  if (bodyError instanceof SyntaxError && bodyError.status === 400 && "body" in bodyError) {
    fail(res, 400, "Invalid JSON body");
    return;
  }
  console.error(err.stack);
  fail(res, 500, "Internal server error");
});

setupSocketHandlers(io);
// Phase 2.1 — Inject Socket.IO instance into messages controller so it can emit real-time events
setIoInstance(io);
// Calls module — inject Socket.IO for call lifecycle events
setCallIoInstance(io);
// Dating module — inject Socket.IO instance for match events
setDatingIoInstance(io);

// Initialize Firebase Admin for push notifications (no-op when not configured)
initFirebase();
// Initialize APNs provider for iOS VoIP call pushes (no-op when not configured)
initApns();
// Durable missed-call expiry worker (runs every 10s)
setCallExpiryIo(io);
callExpiryJob();
// Durable call-push delivery worker (sends outbox rows + fetches Expo receipts)
pushDeliveryJob();

export { server };
export default app;
