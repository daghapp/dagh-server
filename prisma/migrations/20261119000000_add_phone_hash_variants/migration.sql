-- Phone hash variants for format-independent contact matching.
-- Stores every plausible SHA-256 phone form so a contact sent as a
-- pre-computed hash can still match a user registered in a different format.

CREATE TABLE IF NOT EXISTS "phone_hash_variants" (
  "id"     TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hash"   TEXT NOT NULL,
  CONSTRAINT "phone_hash_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "phone_hash_variants_hash_userId_key"
  ON "phone_hash_variants"("hash", "userId");

CREATE INDEX IF NOT EXISTS "phone_hash_variants_hash_idx"
  ON "phone_hash_variants"("hash");

ALTER TABLE "phone_hash_variants"
  ADD CONSTRAINT "phone_hash_variants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
