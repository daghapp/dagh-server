# Virtual Tour Guide — Implementation Guide (dagh-server)

A comprehensive, project-specific guide for building a **Virtual Tour Guide** feature
**inside this repository** (`dagh-server`). It follows the existing conventions:
modules → controllers, `src/routes/*.routes.ts`, Zod validators, Prisma models,
Socket.IO, and standardized response helpers.

> **Stack in this project**
> - Express 5 + TypeScript (ESM), Socket.IO + Redis adapter
> - Prisma + PostgreSQL (`generated/prisma/client.js`)
> - JWT auth (`protectedRoute`) + admin guard (`requireAdmin`)
> - Zod validation (`src/validator` + `validate` middleware)
> - Standardized envelope via `src/helpers/response.ts` (`ok`, `created`, `fail`, `paginated`)
> - Cloudinary media uploads (`src/middleware/cloudinary-upload.ts`)
> - Swagger/OpenAPI via JSDoc annotations, Vitest tests in `tests/`

Existing tour models this feature plugs into: `tour_packages`, `tour_locations`,
`tour_media`, `tour_itineraries`, `tour_bookings`, `TourGuide`.

---

## 1. What "Virtual Tour Guide" Means Here

Users explore venues remotely: a **virtual tour** contains an ordered chain of
**stops**, each with **360° panoramas / images / audio / video** and narration.
Users navigate stops, view media, and the backend tracks their **progress**
(walkthrough). Admins create/curate tours and upload media. A guided/live mode
opt-in via Socket.IO lets a guide push stop changes to viewers.

The backend owns content + state; the frontend does the rendering.

---

## 2. Architecture

```
Frontend (React/App) ──REST + WSS──► Express (this repo)
                                      │
               ┌──────────────────────┼──────────────────────────┐
               ▼                      ▼                          ▼
          PostgreSQL             Redis                      Cloudinary
          (Prisma:              (Socket.IO adapter,      (pano/image/audio/
           virtual_tours,        rate limiting)            video storage)
           stops, progress)
```

New files follow the existing layout:

```
prisma/schema.prisma                       # + new models (section 4)
src/validator/virtual-tour-validator.ts    # Zod schemas (section 5)
src/modules/virtual-tour/
├── user-virtual-tour.controller.ts        # public + user endpoints
├── admin-virtual-tour.controller.ts       # admin CRUD + uploads
└── virtual-tour.service.ts                # business logic + search/progress
src/routes/virtual-tour.routes.ts          # router + Swagger annotations
src/middleware/virtual-tour-upload.ts      # multer → Cloudinary (pano/audio/video)
src/sockets/socketHandlers.ts              # + guided tour events (section 8)
src/server.ts                              # mount router (section 9)
tests/virtual-tour.test.ts                 # Vitest coverage (section 11)
```

---

## 3. Existing Prisma Conventions to Match

- Model names are **snake_case** (`tour_packages`, `tour_bookings`); fields are camelCase
  unless the table is legacy (`tour_media.id`, `tour_media.tour_id`).
- Relations on `User` are appended to the `User` model with `tour*[]` arrays.
- New models use `String @id @default(uuid())` and `@@map()` only when the class
  name differs from the table name.

---

## 4. Database Schema (Add to `prisma/schema.prisma`)

### 4.1 New models

```prisma
model virtual_tours {
  id           String               @id @default(uuid())
  tourId       String?              // optional link to an existing tour_packages
  title        String
  slug         String               @unique
  description  String?
  status       String               @default("draft") // draft | published
  createdBy    String?
  createdAt    DateTime             @default(now())
  updatedAt    DateTime?            @updatedAt
  tour         tour_packages?       @relation(fields: [tourId], references: [id], onDelete: SetNull)
  stops        virtual_tour_stops[]
  media        virtual_tour_media[]
  visits       tour_visits[]
  progress     user_tour_progress[]
}

model virtual_tour_stops {
  id         String               @id @default(uuid())
  tourId     String
  title      String
  body       String?
  order      Int                  @default(0)
  latitude   Float?               // map pin
  longitude  Float?
  tour       virtual_tours        @relation(fields: [tourId], references: [id], onDelete: Cascade)
  media      virtual_tour_media[]
  progress   user_tour_progress[]

  @@unique([tourId, order])
  @@index([tourId])
}

model virtual_tour_media {
  id          String             @id @default(uuid())
  tourId      String?            // tour-level (cover) if stopId is null
  stopId      String?            // stop-level if tourId is null
  kind        String             // IMAGE | PANORAMA_360 | AUDIO | VIDEO | NARRATION
  url         String
  publicId    String?            // Cloudinary public_id (for delete)
  durationSec Int?
  altText     String?
  tour        virtual_tours?     @relation(fields: [tourId], references: [id], onDelete: Cascade)
  stop        virtual_tour_stops?@relation(fields: [stopId], references: [id], onDelete: Cascade)

  @@index([tourId])
  @@index([stopId])
}

model user_tour_progress {
  id        String              @id @default(uuid())
  userId    String
  tourId    String?
  stopId    String
  visitedAt DateTime            @default(now())
  user      User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  tour      virtual_tours?      @relation(fields: [tourId], references: [id], onDelete: Cascade)
  stop      virtual_tour_stops  @relation(fields: [stopId], references: [id], onDelete: Cascade)

  @@unique([userId, stopId])
  @@index([userId])
  @@index([tourId])
}

model tour_visits {
  id          String          @id @default(uuid())
  userId      String
  tourId      String
  startedAt   DateTime        @default(now())
  completedAt DateTime?
  lastStopId  String?
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  tour        virtual_tours   @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tourId])
}
```

### 4.2 Add relations to the existing `User` model

```prisma
model User {
  // ...existing fields
  virtualTourProgress user_tour_progress[]
  tourVisits          tour_visits[]
}
```

### 4.3 Migrate

```bash
npx prisma migrate dev --name add_virtual_tour_guide
```

New files under `dist/` already regenerate via `postinstall`/`db:generate`; the
generated client import path is `../generated/prisma/client.js`, as used in
`src/modules/tour-management/user-tour.controller.ts:17`.

---

## 5. Validators (`src/validator/virtual-tour-validator.ts`)

Create the file, export schemas from `src/validator/index.ts` just like
`tour-validator.ts` does.

```ts
import { z } from "zod";

export const createVirtualTourSchema = z.object({
  tourId: z.string().uuid().optional(),      // link to tour_packages (optional)
  title: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().optional(),
});

export const updateVirtualTourSchema = createVirtualTourSchema.partial();

export const createStopSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const updateStopSchema = createStopSchema.partial();

export const tourVisitSchema = z.object({
  lastStopId: z.string().uuid().optional(),
});

export const stopProgressSchema = z.object({
  tourId: z.string().uuid(),
});
```

---

## 6. Service Layer (`src/modules/virtual-tour/virtual-tour.service.ts`)

Business logic lives here (matching `src/services/*.service.ts` pattern).

```ts
import { prisma } from "../../config/index.js";
import type { PrismaClient } from "../../../generated/prisma/client.js";

/**
 * Resolve a virtual tour by slug and return ordered stops with media.
 * Public reads only return published tours unless `includeDraft`.
 */
export async function getVirtualTourBySlug(slug: string) {
  return prisma.virtual_tours.findFirst({
    where: { slug, status: "published" },
    include: {
      stops: { orderBy: { order: "asc" }, include: { media: true } },
      media: true,
    },
  });
}

/**
 * Near a tour/progress lifetime: start a visit on first action, stamp
 * completedAt once all ordered stops are visited.
 */
export async function startVisit(userId: string, tourId: string) {
  return prisma.tour_visits.upsert({
    where: { id: userId + "_" + tourId }, // see note below
    update: { completedAt: null },
    create: { userId, tourId, startedAt: new Date() },
  });
}

/** Mark a stop visited (idempotent via the unique userId_stopId constraint). */
export async function recordStopProgress(userId: string, tourId: string, stopId: string) {
  return prisma.user_tour_progress.upsert({
    where: { userId_stopId: { userId, stopId } },
    update: { visitedAt: new Date() },
    create: { userId, tourId, stopId, visitedAt: new Date() },
  });
}
```

> **Note on `startVisit` upsert:** `tour_visits` currently has no natural unique
> key for `(userId, tourId)`. Add `@@unique([userId, tourId])` on `tour_visits`
> if you want one visit per user per tour, then the upsert target becomes
> `userId_tourId`. Otherwise query-then-create explicitly to avoid duplicates.

```
Search / nearby stops (Haversine under 25 km) already exists as a helper:
src/helpers/haversine.ts — reuse it or run the SQL in section 10.
```

---

## 7. Controllers

### 7.1 `src/modules/virtual-tour/user-virtual-tour.controller.ts`

Follows `UserTourController` style (class, `ok`/`fail` helpers, `paginated`).

```ts
import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import { getVirtualTourBySlug, recordStopProgress } from "./virtual-tour.service.js";

export class UserVirtualTourController {
  /** GET /virtual-tour — list published virtual tours (paginated) */
  async listTours(req: Request, res: Response) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
      const [tours, total] = await Promise.all([
        prisma.virtual_tours.findMany({
          where: { status: "published" },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.virtual_tours.count({ where: { status: "published" } }),
      ]);
      return paginated(res, tours, total, page, limit);
    } catch (err) {
      return fail(res, 500, "Failed to fetch virtual tours", err);
    }
  }

  /** GET /virtual-tour/:slug — ordered stops + media */
  async getTour(req: Request, res: Response) {
    const tour = await getVirtualTourBySlug(req.params.slug);
    if (!tour) return fail(res, 404, "Virtual tour not found");
    return ok(res, tour);
  }

  /** POST /virtual-tour/stops/:id/visit — auth only */
  async markStopVisited(req: Request, res: Response) {
    const user = req.user as { id: string };
    const { tourId } = req.body as { tourId: string };
    await recordStopProgress(user.id, tourId, req.params.id);
    return ok(res, { visited: true });
  }
}
```

### 7.2 `src/modules/virtual-tour/admin-virtual-tour.controller.ts`

Admin CRUD (create/update/delete tours, stops, media). Use `created()` for writes.

```ts
import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";

export class AdminVirtualTourController {
  async createTour(req: Request, res: Response) {
    try {
      const tour = await prisma.virtual_tours.create({ data: req.body });
      return created(res, tour, "Virtual tour created");
    } catch (err) {
      return fail(res, 500, "Failed to create virtual tour", err);
    }
  }

  /** POST /virtual-tour/:id/stops */
  async addStop(req: Request, res: Response) {
    const stop = await prisma.virtual_tour_stops.create({
      data: { ...req.body, tourId: req.params.id },
    });
    return created(res, stop, "Stop added");
  }

  /** POST /virtual-tour/media — after multer upload ran */
  async attachMedia(req: Request, res: Response) {
    const { tourId, stopId, kind, altText } = req.body;
    const file = req.file as Express.Multer.File & { public_id?: string };
    const media = await prisma.virtual_tour_media.create({
      data: {
        tourId: stopId ? undefined : tourId,
        stopId,
        kind,
        url: file.path, // Cloudinary secure URL
        publicId: (file as any).public_id ?? null,
        altText,
      },
    });
    return created(res, media, "Media attached");
  }
}
```

---

## 8. Routes (`src/routes/virtual-tour.routes.ts`)

Mirror `tour.routes.ts`: Swagger block per route, `validate`, `protectedRoute`,
`requireAdmin`, controller bound with `.bind(controller)`.

```ts
import express from "express";
import { UserVirtualTourController } from "../modules/virtual-tour/user-virtual-tour.controller.js";
import { AdminVirtualTourController } from "../modules/virtual-tour/admin-virtual-tour.controller.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { uploadVirtualTourMedia } from "../middleware/virtual-tour-upload.js";
import {
  createVirtualTourSchema,
  updateVirtualTourSchema,
  createStopSchema,
  updateStopSchema,
  stopProgressSchema,
} from "../validator/index.js";

const router = express.Router();
const userCtrl = new UserVirtualTourController();
const adminCtrl = new AdminVirtualTourController();

// --- Public / user ---
router.get("/", userCtrl.listTours.bind(userCtrl));
router.get("/:slug", userCtrl.getTour.bind(userCtrl));
router.post(
  "/stops/:id/visit",
  protectedRoute,
  validate({ body: stopProgressSchema }),
  userCtrl.markStopVisited.bind(userCtrl),
);

// --- Admin ---
router.post(
  "/",
  protectedRoute,
  requireAdmin,
  validate({ body: createVirtualTourSchema }),
  adminCtrl.createTour.bind(adminCtrl),
);
router.put(
  "/:id",
  protectedRoute,
  requireAdmin,
  validate({ body: updateVirtualTourSchema }),
  adminCtrl.updateTour.bind(adminCtrl),
);
router.delete("/:id", protectedRoute, requireAdmin, adminCtrl.deleteTour.bind(adminCtrl));
router.post(
  "/:id/stops",
  protectedRoute,
  requireAdmin,
  validate({ body: createStopSchema }),
  adminCtrl.addStop.bind(adminCtrl),
);
router.put(
  "/stops/:id",
  protectedRoute,
  requireAdmin,
  validate({ body: updateStopSchema }),
  adminCtrl.updateStop.bind(adminCtrl),
);
router.delete("/stops/:id", protectedRoute, requireAdmin, adminCtrl.deleteStop.bind(adminCtrl));
router.post(
  "/media",
  protectedRoute,
  requireAdmin,
  uploadVirtualTourMedia.single("media"),
  adminCtrl.attachMedia.bind(adminCtrl),
);
router.delete("/media/:id", protectedRoute, requireAdmin, adminCtrl.deleteMedia.bind(adminCtrl));

/**
 * @swagger
 * tags:
 *   - name: Virtual Tour
 *     description: Virtual tour guide (stops, 360° media, progress)
 */
export { router };
```

---

## 9. Mounting (`src/server.ts`)

Add one import and one line, exactly where `TourRoutes` is mounted:

```ts
import { router as VirtualTourRoutes } from "./routes/virtual-tour.routes.js";

app.use("/virtual-tour", VirtualTourRoutes);
```

`/api-docs` will pick up the Swagger annotations automatically.

---

## 10. Media Uploads (`src/middleware/virtual-tour-upload.ts`)

The existing `cloudinary-upload.ts` only allows jpg/png/pdf at 5MB — fine for
covers but not panoramas/audio/video. Add a dedicated middleware:

```ts
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => ({
    folder: "dagh/virtual-tours",
    resource_type: file.mimetype.startsWith("video") ? "video" : "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "mp4", "mp3", "wav"],
    public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
  }),
});

export const uploadVirtualTourMedia = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for 360° / video
});
```

Best practice: store only the Cloudinary `publicId`, add `sign_url` when serving
so assets aren't hot-linked in production.

---

## 11. Guided Tours via Socket.IO (optional)

Join the existing setup — `src/sockets/socketHandlers.ts`, Redis pub/sub adapter
already configured in `src/server.ts`. Add events:

| Event           | Direction | Payload                 | Meaning                             |
| --------------- | --------- | ----------------------- | ----------------------------------- |
| `vtour:join`    | C → S     | `{ tourId }`            | Viewer joins tour room              |
| `vtour:leave`   | C → S     | `{ tourId }`            | Viewer leaves                       |
| `vtour:sync`    | C → S     | `{ tourId, stopId }`    | Guide moves viewers to a stop       |
| `vtour:updated` | S → C     | `{ tourId, update }`    | Content refresh broadcast to room   |

```ts
// inside setupSocketHandlers(io) — add alongside existing handlers
socket.on("vtour:join", (data: { tourId: string }) => socket.join(`vtour:${data.tourId}`));
socket.on("vtour:leave", (data: { tourId: string }) => socket.leave(`vtour:${data.tourId}`));
socket.on("vtour:sync", (data: { tourId: string; stopId: string }) => {
  io.to(`vtour:${data.tourId}`).emit("vtour:updated", { stopId });
});
```

The Redis adapter already fans these out across instances.

---

## 12. Search & Nearby

Simple full-text on `virtual_tour_stops`:

```ts
const stops = await prisma.$queryRaw`
  SELECT * FROM virtual_tour_stops
  WHERE to_tsvector('english', title || ' ' || coalesce(body, ''))
    @@ plainto_tsquery('english', ${q})
  LIMIT 20;`;
```

Nearest stops within radius — reuse `src/helpers/haversine.ts` or raw SQL. For
scale later, index into Meilisearch/Algolia and keep Postgres as source of truth.

---

## 13. Testing (`tests/virtual-tour.test.ts`)

Vitest + Supertest, mirroring `tests/tour-to-dating.test.ts`. Verify list, detail,
auth requirements, progress idempotency, and validation errors.

```ts
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("Virtual Tour API", () => {
  it("lists published virtual tours", async () => {
    const res = await request(app).get("/virtual-tour").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it("returns 401 for stop progress without a token", async () => {
    const res = await request(app).post("/virtual-tour/stops/abc/visit").send({ tourId: "t" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid create payloads", async () => {
    await request(app)
      .post("/virtual-tour")
      .set("Authorization", "Bearer test")
      .send({})
      .expect(400);
  });
});
```

Run: `npm test`, `npm run lint`, `npm run format:check`.

---

## 14. Implementation Roadmap

1. **Schema:** add models (§4) → `prisma migrate dev`.
2. **Validators:** `virtual-tour-validator.ts` + export from `index.ts`.
3. **Service:** `virtual-tour.service.ts` (fetch, visits, progress).
4. **User controller → routes** (list/detail/visit) — mount in `server.ts`.
5. **Admin controller → routes** (CRUD + `virtual-tour-upload` middleware).
6. **Search + nearby.**
7. **Socket.IO guided mode.**
8. **Tests + Swagger sanity-check on `/api-docs`.**
9. Deploy: existing `start` script runs `prisma migrate deploy` automatically.

---

## 15. Key File References

- Response envelope: `src/helpers/response.ts` (`ok`, `created`, `fail`, `paginated`)
- Auth middleware: `src/middleware/protected.ts`, `src/middleware/admin.ts`
- Validation middleware: `src/middleware/validation.ts`
- Existing tour module to copy patterns from: `src/modules/tour-management/`
- Existing route style: `src/routes/tour.routes.ts`
- Socket handler: `src/sockets/socketHandlers.ts`
- Route mounting: `src/server.ts:194` (`app.use("/tours", TourRoutes)`)
- Prisma client: `generated/prisma/client.js`

---

## 16. References

- Express 5: https://expressjs.com
- Prisma: https://prisma.io/docs
- Zod: https://zod.dev
- Socket.IO + Redis adapter: https://socket.io/docs/v4/redis-adapter/
- Cloudinary Node SDK: https://cloudinary.com/documentation/node_integration
- Pannellum (client 360° viewer): https://pannellum.org