-- Add hashed phone columns for privacy-preserving contact matching.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phoneNumberHash" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_phoneNumberHash_key" ON "users"("phoneNumberHash");
