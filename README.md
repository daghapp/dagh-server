# Diaspora Affairs Ghana (DAGH) App - Backend API

## Introduction

The Diaspora Affairs Ghana App backend provides comprehensive services including authentication, tour management, visa processing, user profiles, dating features, and payment infrastructure for diaspora users visiting or connecting to Ghana.

---

## Table of Contents

- [Modules](#modules)
- [Authentication](#1-authentication-module)
- [Profile Management](#2-profile-management-module)
- [Tour Management](#3-tour-management-module)
- [Visa Application](#4-visa-application-module)
- [Payment Management](#5-payment-management-module)
- [Dating Module](#6-dating-module)
- [Reports & Safety](#7-reports--safety-module)
- [Reviews & Ratings](#8-reviews--ratings-module)
- [Notifications](#9-notifications-module)
- [Admin & Settings](#10-admin--settings-module)
- [Database Schema](#database-schema)

---

## Modules

### 1. Authentication Module

**Supported Methods:**
- Email & Password
- Google Authentication
- iCloud Authentication
- Facebook Authentication

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login user |
| POST | `/auth/logout` | Logout user |
| DELETE | `/auth/admin/delete-user/:id` | Delete user (Admin only) |

---

### 2. Profile Management Module

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/profile` | Create a user profile |
| PATCH | `/profile/:id` | Update existing profile |
| GET | `/profile/:id` | Retrieve a user profile |

---

### 3. Tour Management Module

**Features:**
- Add/view/edit/delete tours
- Book tours
- Rate & review tours
- Report service providers

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/tours` | Add a new tour (Provider only) |
| PUT | `/tours/:id` | Edit an existing tour |
| DELETE | `/tours/:id` | Delete a tour |
| GET | `/tours` | Get all tours |
| GET | `/tours/:id` | Get tour details |
| POST | `/tours/:id/book` | Book a tour |
| POST | `/tours/:id/review` | Post a review & rating |
| POST | `/tours/:id/report` | Report a service provider |

---

### 4. Visa Application Module

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/visa/request` | Submit a Visa-on-Arrival request |
| POST | `/visa/approve/:id` | Approve visa request (Admin only) |
| POST | `/visa/reject/:id` | Reject visa request (Admin only) |
| GET | `/visa` | Admin: All visa requests |

---

### 5. Payment Management Module

**Supported Payment Methods:**
- Mobile Money (MTN, Telecel Cash, AirtelTigo Money)
- Card Payments (Visa, Mastercard)
- Paystack
- Stripe
- PayPal

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments/init` | Initialize a payment |
| GET | `/payments/status/:id` | Check payment status |

---

### 6. Dating Module

**Features:**
- Core dating profiles
- Photos & verification
- Demographics & preferences
- Heritage profiles
- Matching algorithms
- Likes, passes, superlikes, blocks
- Safety & moderation

---

### 7. Reports & Safety Module

**Report Categories:**
- Romance scam
- Fake profile
- Harassment
- Inappropriate content
- Financial fraud

---

### 8. Reviews & Ratings Module

**Features:**
- Tour reviews
- Guide ratings
- Accommodation reviews
- Value for money ratings
- Heritage experience ratings

---

### 9. Notifications Module

**Notification Types:**
- Match notifications
- Message alerts
- Booking confirmations
- Payment updates
- Security alerts
- Visa updates

**Channels:**
- Push notifications
- Email
- SMS
- In-app notifications

---

### 10. Admin & Settings Module

**Admin Roles:**
- Super Admin
- Moderator
- Tour Manager

---

## Database Schema

### User Tables

#### Users Table

```prisma
model User {
  id                   String    @id @default(uuid()) @map("user_id")
  authProvider         String    @map("auth_provider") @db.VarChar(20) // google || icloud || facebook || email
  email                String    @unique @db.VarChar(255)
  passwordHash         String?   @map("password_hash") @db.Text
  passwordLastChanged  DateTime? @map("password_last_changed")
  accountStatus        String?   @map("account_status") @db.VarChar(20)
  accountType          String?   @map("account_type") @db.VarChar(20)
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @default(now()) @updatedAt @map("updated_at")
  lastLoginAt          DateTime? @map("last_login_at")
  lastActiveAt         DateTime? @map("last_active_at")

  profile              UserProfile?
  verification         UserVerification?
  security             UserSecurity?
  subscription         UserSubscription?
  preferences          UserPreferences?
  deviceTokens         DeviceToken[]
  suspiciousActivities SuspiciousActivity[]
  scamAlerts           ScamAlert[]
  paymentMethods       PaymentMethod[]

  @@map("users")
}
```

#### User Profile Table

```prisma
model UserProfile {
  id                    String    @id @default(uuid()) @map("profile_id")
  userId                String    @unique @map("user_id")
  username              String?   @db.VarChar(50)
  firstName             String?   @map("first_name") @db.VarChar(100)
  lastName              String?   @map("last_name") @db.VarChar(100)
  dateOfBirth           DateTime? @map("date_of_birth") @db.Date
  gender                String?   @db.VarChar(20)
  nationality           String?   @db.VarChar(5)
  residenceCountry      String?   @map("residence_country") @db.VarChar(100)
  residenceCity         String?   @map("residence_city") @db.VarChar(100)
  residenceState        String?   @map("residence_state") @db.VarChar(100)
  profilePhotoUrl       String?   @map("profile_photo_url") @db.Text
  profilePhotoUploadedAt DateTime? @map("profile_photo_uploaded_at")
  bio                   String?   @db.Text
  languages             String[]  // postgres supports arrays

  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}
```

#### User Verification Table

```prisma
model UserVerification {
  id                String   @id @default(uuid()) @map("verification_id")
  userId            String   @unique @map("user_id")
  isVerified        Boolean  @default(false) @map("is_verified")
  verificationLevel String?  @map("verification_level") @db.VarChar(20)

  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  governmentId      GovernmentId?
  selfieVerification SelfieVerification?
  backgroundCheck   BackgroundCheck?

  @@map("user_verifications")
}
```

#### Government ID Table

```prisma
model GovernmentId {
  id               String    @id @default(uuid()) @map("gov_id")
  verificationId   String    @unique @map("verification_id")
  idType           String?   @map("id_type") @db.VarChar(50)
  number           String?   @db.Text // encrypted
  country          String?   @db.VarChar(50)
  expiryDate       DateTime? @map("expiry_date") @db.Date
  frontImageUrl    String?   @map("front_image_url") @db.Text
  backImageUrl     String?   @map("back_image_url") @db.Text
  uploadedAt       DateTime? @map("uploaded_at")
  verifiedAt       DateTime? @map("verified_at")
  verifiedBy       String?   @map("verified_by")

  verification     UserVerification @relation(fields: [verificationId], references: [id], onDelete: Cascade)

  @@map("government_ids")
}
```

#### Selfie Verification Table

```prisma
model SelfieVerification {
  id             String    @id @default(uuid()) @map("selfie_id")
  verificationId String    @unique @map("verification_id")
  imageUrl       String?   @map("image_url") @db.Text
  matchScore     Int?      @map("match_score")
  verifiedAt     DateTime? @map("verified_at")
  aiProvider     String?   @map("ai_provider") @db.VarChar(50)

  verification   UserVerification @relation(fields: [verificationId], references: [id], onDelete: Cascade)

  @@map("selfie_verifications")
}
```

#### Background Check Table

```prisma
model BackgroundCheck {
  id             String    @id @default(uuid()) @map("check_id")
  verificationId String    @unique @map("verification_id")
  status         String?   @db.VarChar(20)
  provider       String?   @db.VarChar(100)
  completedAt    DateTime? @map("completed_at")
  reportUrl      String?   @map("report_url") @db.Text

  verification   UserVerification @relation(fields: [verificationId], references: [id], onDelete: Cascade)

  @@map("background_checks")
}
```

#### User Security Table

```prisma
model UserSecurity {
  id                 String    @id @default(uuid()) @map("security_id")
  userId             String    @unique @map("user_id")
  twoFactorEnabled   Boolean?  @map("two_factor_enabled")
  twoFactorSecret    String?   @map("two_factor_secret") @db.Text
  loginAttempts      Int       @default(0) @map("login_attempts")
  lockedUntil        DateTime? @map("locked_until")

  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_security")
}
```

#### Suspicious Activity Table

```prisma
model SuspiciousActivity {
  id            String    @id @default(uuid()) @map("activity_id")
  userId        String    @map("user_id")
  flagType      String?   @map("flag_type") @db.VarChar(50)
  description   String?   @db.Text
  severity      String?   @db.VarChar(20)
  detectedAt    DateTime? @map("detected_at")
  resolvedAt    DateTime? @map("resolved_at")
  aiConfidence  Int?      @map("ai_confidence")

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("suspicious_activities")
}
```

#### Scam Alert Table

```prisma
model ScamAlert {
  id          String    @id @default(uuid()) @map("alert_id")
  userId      String    @map("user_id")
  alertType   String?   @map("alert_type") @db.VarChar(50)
  description String?   @db.Text
  triggeredAt DateTime? @map("triggered_at")
  reviewed    Boolean   @default(false)

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("scam_alerts")
}
```

#### Payment Method Table

```prisma
model PaymentMethod {
  id              String   @id @default(uuid()) @map("payment_method_id")
  userId          String   @map("user_id")
  methodType      String?  @map("method_type") @db.VarChar(50)
  provider        String?  @db.VarChar(50)
  last4           String?  @db.VarChar(4)
  expired         Boolean  @default(false)

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptions   UserSubscription[]

  @@map("payment_methods")
}
```

#### User Subscription Table

```prisma
model UserSubscription {
  id              String    @id @default(uuid()) @map("subscription_id")
  userId          String    @unique @map("user_id")
  tier            String?   @db.VarChar(20)
  tourApp         Boolean   @default(false) @map("tour_app")
  eliteDating     Boolean   @default(false) @map("elite_dating")
  startDate       DateTime? @map("start_date")
  endDate         DateTime? @map("end_date")
  autoRenew       Boolean   @default(true) @map("auto_renew")
  paymentMethodId String?   @map("payment_method_id")

  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  paymentMethod   PaymentMethod? @relation(fields: [paymentMethodId], references: [id])
  billingHistory  BillingHistory[]

  @@map("user_subscriptions")
}
```

#### Billing History Table

```prisma
model BillingHistory {
  id              String    @id @default(uuid()) @map("billing_id")
  subscriptionId  String    @map("subscription_id")
  amount          Decimal   @db.Decimal(10, 2)
  currency        String?   @db.VarChar(10)
  paidAt          DateTime? @map("paid_at")
  paymentReference String?  @map("payment_reference") @db.Text

  subscription    UserSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@map("billing_history")
}
```

#### User Preferences Table

```prisma
model UserPreferences {
  id                      String   @id @default(uuid()) @map("preference_id")
  userId                  String   @unique @map("user_id")
  language                String?  @db.VarChar(10)
  currency                String?  @db.VarChar(10)
  emailNotifications      Boolean? @map("email_notifications")
  pushNotifications       Boolean? @map("push_notifications")
  smsNotifications        Boolean? @map("sms_notifications")
  marketingNotifications  Boolean? @map("marketing_notifications")
  showProfile             Boolean? @map("show_profile")
  showLocation            Boolean? @map("show_location")
  allowSearch             Boolean? @map("allow_search")

  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

#### Device Token Table

```prisma
model DeviceToken {
  id       String    @id @default(uuid()) @map("device_id")
  userId   String    @map("user_id")
  token    String?   @db.Text
  platform String?   @db.VarChar(20)
  addedAt  DateTime? @map("added_at")

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("device_tokens")
}
```

---

### Tour Tables

#### Tour Package Table

```prisma
model TourPackage {
  id                  String    @id @default(uuid())
  title               String?   @db.VarChar(255)
  slug                String?   @unique @db.VarChar(255)
  description         String?   @db.Text
  shortDescription    String?   @map("short_description") @db.Text
  category            String?   @db.VarChar(100)
  subcategory         String?   @db.VarChar(100)
  durationDays        Int?      @map("duration_days")
  durationNights      Int?      @map("duration_nights")
  basePrice           Decimal?  @map("base_price") @db.Decimal
  currency            String?   @db.VarChar(10)
  status              String?   @db.VarChar(50)
  featured            Boolean   @default(false)
  trending            Boolean   @default(false)
  cancellationPolicy  String?   @map("cancellation_policy") @db.Text
  bookingDeadline     Int?      @map("booking_deadline")
  minimumBooking      Int?      @map("minimum_booking")
  accessibility       String?   @db.Text
  coverImage          String?   @map("cover_image") @db.Text
  heritageDnaTesting  Boolean   @default(false) @map("heritage_dna_testing")
  overallRating       Decimal?  @map("overall_rating") @db.Decimal(3, 2)
  ratingCount         Int       @default(0) @map("rating_count")
  viewCount           Int       @default(0) @map("view_count")
  bookingCount        Int       @default(0) @map("booking_count")
  wishlistCount       Int       @default(0) @map("wishlist_count")
  shareCount          Int       @default(0) @map("share_count")
  conversionRate      Decimal?  @map("conversion_rate") @db.Decimal(5, 2)
  createdBy           String?   @map("created_by")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime? @updatedAt @map("updated_at")
  publishedAt         DateTime? @map("published_at")

  itineraries         TourItinerary[]
  locations           TourLocation[]
  media               TourMedia[]
  heritageElements    HeritageElement[]
  pricingIncludes     PricingInclude[]
  pricingExcludes     PricingExclude[]
  groupDiscounts      GroupDiscount[]
  seasonalPricing     SeasonalPricing[]
  guides              TourGuide[]

  @@map("tour_packages")
}
```

#### Tour Itinerary Table

```prisma
model TourItinerary {
  id                  String  @id @default(uuid())
  tourId              String  @map("tour_id")
  dayNumber           Int?    @map("day_number")
  title               String? @db.VarChar(255)
  description         String? @db.Text
  breakfast           Boolean?
  lunch               Boolean?
  dinner              Boolean?
  accommodationName   String? @map("accommodation_name") @db.VarChar(255)
  accommodationType   String? @map("accommodation_type") @db.VarChar(100)
  accommodationRating Decimal? @map("accommodation_rating") @db.Decimal(2, 1)

  tour                TourPackage        @relation(fields: [tourId], references: [id], onDelete: Cascade)
  activities          ItineraryActivity[]

  @@map("tour_itineraries")
}
```

#### Itinerary Activity Table

```prisma
model ItineraryActivity {
  id              String  @id @default(uuid())
  itineraryId     String  @map("itinerary_id")
  activityTime    String? @map("activity_time") @db.VarChar(20)
  activity        String? @db.VarChar(255)
  durationMinutes Int?    @map("duration_minutes")
  included        Boolean?
  cost            Decimal? @db.Decimal(10, 2)
  locationName    String? @map("location_name") @db.VarChar(255)
  locationAddress String? @map("location_address") @db.Text
  // locationPoint (PostGIS geography type) needs special handling

  itinerary       TourItinerary @relation(fields: [itineraryId], references: [id], onDelete: Cascade)

  @@map("itinerary_activities")
}
```

#### Tour Location Table

```prisma
model TourLocation {
  id             String  @id @default(uuid())
  tourId         String  @map("tour_id")
  name           String? @db.VarChar(255)
  city           String? @db.VarChar(100)
  region         String? @db.VarChar(100)
  description    String? @db.Text
  visitDuration  Int?    @map("visit_duration")
  // locationPoint (PostGIS geography type) needs special handling
  photos         String[] // postgres supports arrays

  tour           TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("tour_locations")
}
```

#### Tour Media Table

```prisma
model TourMedia {
  id        String  @id @default(uuid())
  tourId    String  @map("tour_id")
  mediaType String? @map("media_type") @db.VarChar(20) // image, video
  url       String? @db.Text

  tour      TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("tour_media")
}
```

#### Heritage Element Table

```prisma
model HeritageElement {
  id     String  @id @default(uuid())
  tourId String  @map("tour_id")
  type   String? @db.VarChar(50) // ancestral, historical, cultural, tribal
  value  String? @db.Text

  tour   TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("heritage_elements")
}
```

#### Pricing Include Table

```prisma
model PricingInclude {
  id     String  @id @default(uuid())
  tourId String  @map("tour_id")
  item   String? @db.Text

  tour   TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("pricing_includes")
}
```

#### Pricing Exclude Table

```prisma
model PricingExclude {
  id     String  @id @default(uuid())
  tourId String  @map("tour_id")
  item   String? @db.Text

  tour   TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("pricing_excludes")
}
```

#### Group Discount Table

```prisma
model GroupDiscount {
  id                 String  @id @default(uuid())
  tourId             String  @map("tour_id")
  minSize            Int?    @map("min_size")
  discountPercentage Decimal? @map("discount_percentage") @db.Decimal(4, 1)

  tour               TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("group_discounts")
}
```

#### Seasonal Pricing Table

```prisma
model SeasonalPricing {
  id            String   @id @default(uuid())
  tourId        String   @map("tour_id")
  season        String?  @db.VarChar(100)
  startDate     DateTime? @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  priceModifier Decimal? @map("price_modifier") @db.Decimal(4, 1)

  tour          TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("seasonal_pricing")
}
```

#### Tour Guide Table

```prisma
model TourGuide {
  id      String  @id @default(uuid())
  tourId  String  @map("tour_id")
  guideId String? @map("guide_id")
  name    String? @db.VarChar(255)
  photo   String? @db.Text
  bio     String? @db.Text

  tour    TourPackage @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@map("tour_guides")
}
```

---

### Transaction Tables

#### Transaction Table

```prisma
model Transaction {
  id                    String    @id @default(uuid()) @map("_id")
  transactionReference  String    @unique @map("transaction_reference")
  userId                String    @map("user_id")
  relatedEntityType     String?   @map("related_entity_type") // booking, subscription, dating_feature
  relatedEntityId       String?   @map("related_entity_id")
  amount                Decimal   @db.Decimal(10, 2)
  currency              String    @db.VarChar(10)
  type                  String    // payment, refund, payout
  category              String    // tour_booking, premium_subscription, search_credit
  paymentMethodType     String?   @map("payment_method_type") // momo, card, bank_transfer, paystack
  paymentProvider       String?   @map("payment_provider") // mtn_momo, vodafone_cash, paystack, stripe, paypal
  status                String    // pending, processing, completed, failed, refunded, cancelled
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  completedAt           DateTime? @map("completed_at")

  @@map("transactions")
}
```

---

### Review Tables

#### Review Table

```prisma
model Review {
  id                 String    @id @default(uuid()) @map("_id")
  targetEntityType   String    @map("target_entity_type") // tour_package, guide, accommodation
  targetEntityId     String    @map("target_entity_id")
  userId             String    @map("user_id")
  bookingId          String?   @map("booking_id")
  verified           Boolean   @default(false)
  overallRating      Decimal   @map("overall_rating") @db.Decimal(2, 1)
  experienceRating   Decimal?  @map("experience_rating") @db.Decimal(2, 1)
  guideRating        Decimal?  @map("guide_rating") @db.Decimal(2, 1)
  valueForMoneyRating Decimal? @map("value_for_money_rating") @db.Decimal(2, 1)
  organizationRating Decimal?  @map("organization_rating") @db.Decimal(2, 1)
  heritageRating     Decimal?  @map("heritage_rating") @db.Decimal(2, 1)
  title              String?   @db.VarChar(255)
  review             String?   @db.Text
  status             String    @default("pending") // pending, approved, rejected, flagged
  featured           Boolean   @default(false)
  helpfulCount       Int       @default(0) @map("helpful_count")
  notHelpfulCount    Int       @default(0) @map("not_helpful_count")
  reportCount        Int       @default(0) @map("report_count")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@map("reviews")
}
```

---

### Authentication Tables

#### Refresh Token Table

```prisma
model RefreshToken {
  id                String    @id @default(uuid()) @map("_id")
  userId            String    @map("user_id")
  token             String    @unique @db.Text // hashed refresh token
  tokenFamily       String?   @map("token_family") // for rotation detection
  isRevoked         Boolean   @default(false) @map("is_revoked")
  revokedAt         DateTime? @map("revoked_at")
  revokedReason     String?   @map("revoked_reason") @db.VarChar(50)
  deviceId          String?   @map("device_id")
  deviceName        String?   @map("device_name")
  platform          String?   @db.VarChar(20) // ios, android, web
  ipAddress         String?   @map("ip_address")
  issuedAt          DateTime  @default(now()) @map("issued_at")
  expiresAt         DateTime  @map("expires_at")
  lastUsedAt        DateTime? @map("last_used_at")
  usageCount        Int       @default(0) @map("usage_count")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@index([tokenFamily])
  @@index([isRevoked])
  @@index([expiresAt])
  @@map("refresh_tokens")
}
```

#### Blacklisted Token Table

```prisma
model BlacklistedToken {
  id              String    @id @default(uuid()) @map("_id")
  jti             String    @unique // JWT ID
  userId          String    @map("user_id")
  token           String    @db.Text
  tokenType       String    @map("token_type") // access, refresh
  reason          String    @db.VarChar(100) // logout, password_change, account_deletion, security_breach
  blacklistedAt   DateTime  @default(now()) @map("blacklisted_at")
  expiresAt       DateTime  @map("expires_at")

  @@index([userId])
  @@index([expiresAt])
  @@map("blacklisted_tokens")
}
```

#### Password Reset Token Table

```prisma
model PasswordResetToken {
  id        String    @id @default(uuid()) @map("_id")
  userId    String    @map("user_id")
  token     String    @unique @db.Text // hashed token
  isUsed    Boolean   @default(false) @map("is_used")
  usedAt    DateTime? @map("used_at")
  ipAddress String?   @map("ip_address")
  createdAt DateTime  @default(now()) @map("created_at")
  expiresAt DateTime  @map("expires_at") // typically 1 hour

  @@index([userId])
  @@index([expiresAt])
  @@map("password_reset_tokens")
}
```

#### Email Verification Token Table

```prisma
model EmailVerificationToken {
  id             String    @id @default(uuid()) @map("_id")
  userId         String    @map("user_id")
  email          String    @db.VarChar(255)
  token          String    @unique @db.Text // hashed token
  isVerified     Boolean   @default(false) @map("is_verified")
  verifiedAt     DateTime? @map("verified_at")
  attempts       Int       @default(0)
  lastAttemptAt  DateTime? @map("last_attempt_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  expiresAt      DateTime  @map("expires_at") // typically 24 hours

  @@index([userId])
  @@index([email])
  @@index([expiresAt])
  @@map("email_verification_tokens")
}
```

---

### Notification Table

```prisma
model Notification {
  id                String    @id @default(uuid()) @map("_id")
  userId            String    @map("user_id")
  type              String    // match, message, booking_confirmation, payment, security_alert, visa_update
  category          String    // dating, tour, account, security
  title             String
  message           String    @db.Text
  actionUrl         String?   @map("action_url")
  actionLabel       String?   @map("action_label")
  relatedEntityType String?   @map("related_entity_type")
  relatedEntityId   String?   @map("related_entity_id")
  pushSent          Boolean   @default(false) @map("push_sent")
  pushSentAt        DateTime? @map("push_sent_at")
  emailSent         Boolean   @default(false) @map("email_sent")
  emailSentAt       DateTime? @map("email_sent_at")
  smsSent           Boolean   @default(false) @map("sms_sent")
  smsSentAt         DateTime? @map("sms_sent_at")
  inAppRead         Boolean   @default(false) @map("in_app_read")
  inAppReadAt       DateTime? @map("in_app_read_at")
  priority          String    @default("medium") // low, medium, high, urgent
  status            String    @default("pending") // pending, sent, failed, read, archived
  createdAt         DateTime  @default(now()) @map("created_at")
  expiresAt         DateTime? @map("expires_at")

  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@map("notifications")
}
```

---

### Admin Table

```prisma
model AdminUser {
  id          String    @id @default(uuid()) @map("_id")
  email       String    @unique
  password    String
  firstName   String?   @map("first_name")
  lastName    String?   @map("last_name")
  photo       String?
  role        String    // super_admin, moderator, tour_manager
  permissions String[]  // granular permissions
  status      String    @default("active") // active, suspended
  lastLoginAt DateTime? @map("last_login_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([email])
  @@index([role])
  @@index([status])
  @@map("admin_users")
}
```

---

## Module Summary

| Table | Purpose |
|-------|---------|
| `users` | Core authentication + account data |
| `user_profiles` | Personal profile data |
| `user_verifications` | Verification levels & statuses |
| `government_ids` | Passport/ID verification docs |
| `selfie_verifications` | Face/selfie verification |
| `background_checks` | Background check results |
| `user_security` | Security, login attempts, 2FA |
| `suspicious_activities` | Logs of suspicious activity |
| `scam_alerts` | Scam alert logs |
| `user_subscriptions` | Subscription tier + module access |
| `billing_history` | List of payments |
| `payment_methods` | Saved payment methods |
| `user_preferences` | Notification & privacy settings |
| `device_tokens` | Mobile FCM tokens |
| `tour_packages` | Tour details and information |
| `tour_itineraries` | Daily tour plans |
| `itinerary_activities` | Activities within itinerary |
| `tour_locations` | Tour locations |
| `tour_media` | Tour images and videos |
| `heritage_elements` | Heritage information |
| `tour_guides` | Guide information |
| `transactions` | Payment transactions |
| `reviews` | User reviews and ratings |
| `refresh_tokens` | JWT refresh tokens |
| `blacklisted_tokens` | Revoked tokens |
| `password_reset_tokens` | Password reset tokens |
| `email_verification_tokens` | Email verification tokens |
| `notifications` | User notifications |
| `admin_users` | Admin user accounts |

---

## Tech Stack

- **Backend Framework:** Node.js / Express.js
- **Database:** PostgreSQL with PostGIS
- **ORM:** Prisma
- **Authentication:** JWT (Access & Refresh Tokens)
- **Payment Processing:** Paystack, Stripe, PayPal, Mobile Money
- **File Storage:** Cloud storage (AWS S3 / Cloudinary)
- **Push Notifications:** FCM (Firebase Cloud Messaging)

---

## Installation

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate

# Start development server
npm run dev
```

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dagh_db
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
PAYSTACK_SECRET_KEY=your_paystack_key
STRIPE_SECRET_KEY=your_stripe_key
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
FCM_SERVER_KEY=your_fcm_key
```

---

## License

Proprietary - Diaspora Affairs Ghana

---

## Contact

For support or inquiries, contact the development team.
