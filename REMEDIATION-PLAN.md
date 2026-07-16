# Dagh-Server Remediation Plan

Prioritized action items derived from the full codebase audit. Items are grouped into tiers by risk and effort.

---

## Tier 1 — Critical Security Fixes (do first)

### 1.1 Stop leaking `passwordHash` in API responses

**Files:** `src/modules/authentication/password-auth.controller.ts`

Registration and login return the full Prisma `User` object, which includes `passwordHash`. Create a safe user type or use `select`/`exclude` to strip sensitive fields before sending responses.

```ts
// Before
return res.status(201).json({ success: true, data: newUser });

// After
const { passwordHash, ...safeUser } = newUser;
return res.status(201).json({ success: true, data: safeUser });
```

Apply the same pattern to every endpoint that returns a user object (login, OAuth callbacks, admin user listing, profile reads).

---

### 1.2 Tighten CORS configuration

**File:** `src/server.ts`

The current fallback `origin: process.env.API_URL || '*'` opens the API to any origin when the env var is unset, even with `credentials: true`.

- Remove the `|| '*'` fallback — require `API_URL` to be set.
- If a wildcard is genuinely needed for local dev, only allow it when `NODE_ENV !== 'production'`.
- Consider supporting a comma-separated list of allowed origins.

```ts
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
```

---

### 1.3 Protect file upload endpoint

**File:** `src/routes/image-upload.route.ts`

`/upload` has no auth middleware — anyone can upload to Cloudinary.

```ts
router.post('/', protectedRoute, upload.single('image'), ...);
```

---

### 1.4 Stop passing tokens in redirect URLs

**Files:** `src/modules/authentication/google-auth.controller.ts`, `src/modules/authentication/facebook-auth.controller.ts`

OAuth callbacks put `accessToken` and `refreshToken` in query strings. Instead:

- Store tokens in an HTTP-only cookie, or
- Return a short-lived authorization code that the client exchanges for tokens via a POST endpoint.

This prevents token leakage in browser history, server logs, and referrer headers.

---

### 1.5 Fix Hubtel config failure mode

**File:** `src/config/hubtel.ts`

Currently throws an error if Hubtel credentials are missing, which crashes the server on startup. This is actually better than `console.error`, but should be validated at boot with a clear message:

```ts
const required = ['HUBTEL_CLIENT_ID', 'HUBTEL_CLIENT_SECRET', 'HUBTEL_MERCHANT_NUMBER'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}
```

---

## Tier 2 — Architecture & Wiring Fixes

### 2.1 Wire up or remove the messages module

**Files:** `src/server.ts`, `src/modules/messages/messages.controller.ts`

- The messages route file exists but is never registered in `server.ts`.
- `setIoInstance()` is never called, so the Socket.IO instance is never injected into the controller.
- Real-time messaging cannot work.

**Actions:**
1. Register the message routes in `server.ts`.
2. Call `setIoInstance(io)` after Socket.IO is initialized.
3. If messaging is not planned for the near term, delete the dead code and document it as a future feature.

---

### 2.2 Extract fat controllers into services

Almost all business logic lives in controllers talking directly to Prisma. Only `itinerary.service.ts` follows a service pattern.

**Priority extraction targets:**

| Controller | Service to create | Why |
|---|---|---|
| `payment.controller.ts` | `payment.service.ts` | Payment logic is duplicated (instance vs static methods), mixed with Prisma calls, not transactional |
| `user-tour.controller.ts` | `tour.service.ts` | Tour booking, payment callback, and ledger logic should be in one place |
| `user-visa.controller.ts` | `visa.service.ts` | Same as above — visa payment and approval flows |
| `password-auth.controller.ts` | `auth.service.ts` | Registration, login, OAuth, password reset — core auth should be reusable |

Pattern:
```ts
// src/services/payment.service.ts
export class PaymentService {
  async initializePayment(userId: string, dto: InitializePaymentDto): Promise<PaymentResult> {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: { ... } });
      const checkout = await hubtelClient.post(...);
      return { payment, checkout };
    });
  }
}
```

---

### 2.3 Wrap multi-step payment flows in transactions

**Files:** `src/jobs/check-pending-payments.ts`, `src/modules/itinerary/itinerary.payment.controller.ts`, `src/modules/visa-management/user-visa.controller.ts`

Most payment flows create/update multiple records without `$transaction`. If any step fails, the database is left in an inconsistent state.

Audit every place that:
1. Creates a `Payment` record
2. Updates a related `TourRequest`, `VisaOnArrivalRequest`, or `Itinerary`
3. Creates `LedgerTransaction` records

Wrap each group in `prisma.$transaction()`.

---

### 2.4 Drive pricing from config or database

**File:** `src/jobs/check-pending-payments.ts`

Hardcoded amounts (e.g. `464`, `1450` GHS) should come from:
- Environment variables (quick fix), or
- A `PricingConfig` table in the database (proper fix)

---

### 2.5 Remove or implement the `AuditLog` model

**File:** `prisma/schema.prisma`

`AuditLog` is defined in the schema but never referenced in application code. Either:
- Instrument critical operations (admin actions, payment state changes, verification approvals) to write audit logs, or
- Remove the model to reduce schema noise.

---

## Tier 3 — Quality & Developer Experience

### 3.1 Add automated testing

No test files exist. Priority test targets:

| Area | Test type | Why |
|---|---|---|
| Auth (register, login, reset) | Unit + integration | Core security — password hashing, OTP flow, token generation |
| Payment initialization + callbacks | Integration | Financial correctness, Hubtel integration |
| Visa approval flow | Integration | Multi-step business logic |
| Profile verification (admin) | Integration | CRUD + authorization checks |
| Hubtel callback middleware | Unit | Security gate — must reject invalid payloads |

Recommended setup:
- **Vitest** (fast, TypeScript-native, works well with Prisma)
- **Supertest** for HTTP integration tests
- **Prisma `@prisma/client/testing`** or in-memory SQLite for test DB

---

### 3.2 Add linting and formatting

No ESLint or Prettier config exists.

```bash
npm i -D eslint prettier eslint-config-prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

Create `.eslintrc.json` and `.prettierrc` with rules matching the existing code style. Add to `package.json`:

```json
"lint": "eslint src/ --ext .ts",
"format": "prettier --write src/"
```

---

### 3.3 Create `.env.example`

Document all required environment variables:

```env
# Database
DATABASE_URL=

# Auth
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# Hubtel
HUBTEL_CLIENT_ID=
HUBTEL_CLIENT_SECRET=
HUBTEL_MERCHANT_NUMBER=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email
RESEND_API_KEY=

# CORS
API_URL=
ALLOWED_ORIGINS=

# Currency
USD_TO_GHS_RATE=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
```

---

### 3.4 Standardize API response format

Responses currently mix `{ success, message }`, `{ message }`, `{ success, data }`, and `{ error }`.

Pick one shape and apply it everywhere:

```ts
// Success
{ success: true, data: T, message?: string }

// Error
{ success: false, error: string, details?: Record<string, string> }
```

Create a `src/helpers/response.ts` helper:

```ts
export function ok<T>(res: Response, data: T, message?: string) {
  return res.json({ success: true, data, message });
}

export function fail(res: Response, status: number, error: string, details?: Record<string, string>) {
  return res.status(status).json({ success: false, error, details });
}
```

---

### 3.5 Fix naming inconsistencies

| Issue | Fix |
|---|---|
| `SubscribtionPaymentSchema` typo | Rename to `SubscriptionPaymentSchema` |
| Prisma model casing mix (`User` vs `tour_bookings`) | Use `@@map` to keep DB tables snake_case but Prisma models PascalCase consistently |
| `src/Modules/` → `src/modules/` | Already done in latest commit |

---

### 3.6 Remove `any` types

Controllers, payment code, and OAuth handlers use `any` heavily. Create proper types for:

- Hubtel API responses
- JWT decoded payloads (already partially done with `jwt.JwtPayload`)
- Prisma relation types (use `Prisma.UserGetPayload<{ include: ... }>` instead of `any`)
- OAuth profile objects (use `Profile` from passport strategies)

---

## Tier 4 — Operations & Production Readiness

### 4.1 Externalize cron jobs

Cron jobs run in-process. With multiple Render instances, jobs would execute multiple times.

Options:
- **BullMQ + Redis** — proper job queue with deduplication
- **External cron service** (e.g. cron-job.org hitting a protected endpoint)
- **Render cron jobs** — if staying on Render, use their cron service type

---

### 4.2 Improve health check

**File:** `src/server.ts`

```ts
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});
```

---

### 4.3 Add structured logging

Replace `console.log`/`console.error` with a structured logger:

- **pino** — fast, JSON output, works well with Express
- Add request IDs via middleware for traceability
- Consider error tracking (Sentry or similar)

---

### 4.4 Improve graceful shutdown

**File:** `src/index.ts`

```ts
const shutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down...`);
  cronJobs.forEach(job => job.stop());  // stop cron tasks
  httpServer.close(() => {
    prisma.$disconnect();  // close DB connections
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};
```

---

### 4.5 Align README with reality

The README describes features that don't exist (dating, reviews, notifications, Paystack/Stripe, PostGIS, iCloud auth, refresh token rotation, 2FA, account lockout).

**Options:**
1. Remove unimplemented sections and mark them as "Planned"
2. Create a separate `ROADMAP.md` for future features
3. Add badges or status indicators per module

---

## Implementation Order

| Phase | Items | Estimated effort |
|---|---|---|
| **Phase 1** (security) | 1.1–1.5 | 1–2 days |
| **Phase 2** (wiring) | 2.1–2.5 | 3–5 days |
| **Phase 3** (quality) | 3.1–3.6 | 5–7 days |
| **Phase 4** (ops) | 4.1–4.5 | 3–5 days |
| **Total** | | ~12–19 days |

Phase 1 can ship immediately as a hotfix. Phase 2–4 should be planned as sprint work.
