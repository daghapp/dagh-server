-- Sign in with Apple identity.
--
-- `appleId` stores Apple's stable `sub` claim. Email is not a safe account key
-- for Apple: it may be absent or a private-relay address, and matching on it
-- allowed an Apple login without an email to resolve to another user.
--
-- `appleRefreshToken` is the encrypted refresh token returned by Apple's token
-- endpoint. It is retained only so self-service account deletion can revoke the
-- Apple grant, as required by App Store Guideline 5.1.1(v).
--
-- Guarded so the migration is safely re-runnable.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "appleId" TEXT,
  ADD COLUMN IF NOT EXISTS "appleRefreshToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_appleId_key" ON "users"("appleId");
