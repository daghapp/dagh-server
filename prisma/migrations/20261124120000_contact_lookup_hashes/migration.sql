ALTER TABLE "contact_sync_consents" ADD COLUMN "lookupHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
