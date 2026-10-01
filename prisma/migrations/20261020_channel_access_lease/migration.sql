-- Channel access becomes a leased, versioned authorization record.
--
-- channel_unlocks answered "was this subscription ever confirmed?" with a
-- boolean-ish row: a grant written once, never re-checked, never expiring, and
-- carrying no version to order two conflicting answers by. That is enough to
-- unlock a feed, and not enough to satisfy the contract the product now needs:
--
--   * one decision per (user, channel) that every surface reads — feed, detail,
--     unlock, status, login — so no endpoint can disagree with another;
--   * a positive verdict that EXPIRES, so a user who unsubscribes on YouTube
--     loses access on a bounded interval even if every poll is missed;
--   * an explicit status for "we could not check" that is distinct from "we
--     checked and the answer was no", because YouTube publishes no event on
--     unsubscribe and the only way to learn about one is to ask;
--   * a monotonic version, so a slow response that arrives after a revocation
--     cannot resurrect it client-side;
--   * the Google identity behind the link, so the same-email rule is auditable
--     and the credential is renewable instead of a one-shot access token.
--
-- The table is renamed rather than replaced, so the (userId, channelId) unique
-- key and every existing audit row carry over. The re-verification sweep and the
-- admin grant console keep working against the same data; only the vocabulary
-- changes (lastVerifiedAt folds into verifiedAt, which is now always "the last
-- time a check succeeded").

-- AlterTable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'channel_unlocks')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'channel_access')
  THEN
    ALTER TABLE "channel_unlocks" RENAME TO "channel_access";
  END IF;
END$$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChannelAccessStatus') THEN
    CREATE TYPE "ChannelAccessStatus" AS ENUM (
      'SUBSCRIBED',
      'NOT_SUBSCRIBED',
      'NOT_CONNECTED',
      'REAUTH_REQUIRED',
      'CHECK_FAILED'
    );
  END IF;
END$$;

-- AlterTable
-- IF NOT EXISTS throughout, per the repo convention, so a partially-applied
-- attempt is recovered by re-running `migrate deploy`.
ALTER TABLE "channel_access"
  ADD COLUMN IF NOT EXISTS "status" "ChannelAccessStatus",
  ADD COLUMN IF NOT EXISTS "accessVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "accessExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "googleSubject" TEXT,
  ADD COLUMN IF NOT EXISTS "googleEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "authorizedYoutubeChannelId" TEXT,
  ADD COLUMN IF NOT EXISTS "grantedScopes" TEXT;

-- verifiedAt now means "the last check that succeeded" rather than "when the
-- grant was first issued", so the sweep's separate lastVerifiedAt marker is
-- redundant. Fold it in, keeping whichever timestamp is older so nothing claims
-- to be fresher than the evidence actually is. Guarded on the column still being
-- present, so a re-run after the DROP below is a no-op rather than an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'channel_access' AND column_name = 'lastVerifiedAt'
  ) THEN
    UPDATE "channel_access"
    SET "verifiedAt" = LEAST(
          COALESCE("verifiedAt", "lastVerifiedAt"),
          COALESCE("lastVerifiedAt", "verifiedAt")
        )
    WHERE "verifiedAt" IS DISTINCT FROM COALESCE("lastVerifiedAt", "verifiedAt");
  END IF;
END$$;

ALTER TABLE "channel_access" DROP COLUMN IF EXISTS "lastVerifiedAt";

-- Derive the initial status for every existing row.
--
-- A row holding a refresh token has a renewable credential, so it is
-- SUBSCRIBED — but its lease is set to expire at the moment of the migration
-- rather than in the future. Those grants were last confirmed on a 24h sweep
-- cadence and have not been re-checked since, so honouring a fresh 60s lease
-- would hand out access on the strength of a stale verdict. Expiring them makes
-- the next read pay for a check, which is the point.
--
-- A row WITHOUT a refresh token cannot be re-checked at all. It used to be
-- trusted forever for exactly that reason, which meant an unsubscribed user
-- whose token was lost kept the feed permanently. It is now REAUTH_REQUIRED:
-- the user is told to reconnect Google, and if they were still subscribed that
-- costs them one consent screen rather than their access.
--
-- Already-revoked rows keep their revocation and report NOT_SUBSCRIBED, which
-- is what they were; the operator's MANUAL revocation is preserved in
-- revokedReason either way.
UPDATE "channel_access"
SET
  "status" = CASE
    WHEN "revokedAt" IS NOT NULL THEN 'NOT_SUBSCRIBED'::"ChannelAccessStatus"
    WHEN "refreshToken" IS NULL OR "refreshToken" = '' THEN 'REAUTH_REQUIRED'::"ChannelAccessStatus"
    ELSE 'SUBSCRIBED'::"ChannelAccessStatus"
  END,
  "accessExpiresAt" = CASE
    WHEN "revokedAt" IS NOT NULL THEN NULL
    WHEN "refreshToken" IS NULL OR "refreshToken" = '' THEN NULL
    -- Lease already lapsed: the next read forces a fresh check.
    ELSE CURRENT_TIMESTAMP
  END
WHERE "status" IS NULL;

-- Rows predating the status column can only exist if this statement was
-- interrupted; make the column total so no read has to null-check it.
UPDATE "channel_access"
SET "status" = 'NOT_CONNECTED'::"ChannelAccessStatus"
WHERE "status" IS NULL;

-- The default matches the Prisma schema so `migrate diff` reports no drift. A
-- row created without an explicit status is a link we have not verified, which
-- is exactly NOT_CONNECTED: no check has been made, so no access is implied.
ALTER TABLE "channel_access"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'NOT_CONNECTED';

-- Index rename. The old (userId, revokedAt) index is dropped and recreated under
-- its new name so `prisma migrate diff` does not see a phantom change forever;
-- the column list is identical, so this is a rename in name only.
DROP INDEX IF EXISTS "channel_unlocks_userId_revokedAt_idx";
DROP INDEX IF EXISTS "channel_access_userId_revokedAt_idx";

-- Rename the surviving constraints to match the table they now live on. ALTER
-- TABLE ... RENAME leaves the old names behind, which is cosmetic but not
-- harmless: a later `prisma migrate diff` compares the live database against the
-- schema and reports the leftovers as drift, so the next person to run it gets a
-- migration that "fixes" nothing. Each is guarded so a re-run is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_unlocks_pkey'
  ) THEN
    ALTER TABLE "channel_access" RENAME CONSTRAINT "channel_unlocks_pkey"
      TO "channel_access_pkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_unlocks_userId_fkey'
  ) THEN
    ALTER TABLE "channel_access" RENAME CONSTRAINT "channel_unlocks_userId_fkey"
      TO "channel_access_userId_fkey";
  END IF;
END$$;

DO $$
BEGIN
  -- A previous, less careful run of an earlier revision of this migration can
  -- leave both names present — a rename that hit the guard and a fresh CREATE
  -- that did not. Two unique indexes over the same columns is not a state the
  -- Prisma schema can describe, so collapse it back to one before continuing.
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'channel_access_userId_channelId_key'
  ) AND EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'channel_unlocks_userId_channelId_key'
  ) THEN
    DROP INDEX "channel_unlocks_userId_channelId_key";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'channel_unlocks_userId_channelId_key'
  ) THEN
    ALTER INDEX "channel_unlocks_userId_channelId_key"
      RENAME TO "channel_access_userId_channelId_key";
  END IF;

  -- The rename above covers the normal path. This covers the other one: a table
  -- that already carried the new name would never have had the old index, and
  -- the (userId, channelId) uniqueness is what makes the record one-per-pair
  -- rather than several conflicting decisions for the same channel.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'channel_access'
      AND i.indisunique
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a
             ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
          = ARRAY['userId', 'channelId']::text[]
  ) THEN
    CREATE UNIQUE INDEX "channel_access_userId_channelId_key"
      ON "channel_access"("userId", "channelId");
  END IF;
END$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_access_userId_revokedAt_idx"
  ON "channel_access"("userId", "revokedAt");

-- CreateIndex
-- Drives the active-user poll: rows whose lease has lapsed are exactly the ones
-- whose access is no longer backed by a current verdict.
CREATE INDEX IF NOT EXISTS "channel_access_status_accessExpiresAt_idx"
  ON "channel_access"("status", "accessExpiresAt");
