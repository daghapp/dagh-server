-- AlterTable
ALTER TABLE "user_devices" ADD COLUMN "publicKey" TEXT,
ADD COLUMN "keyVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "keyUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "ciphertext" TEXT,
ADD COLUMN "nonce" TEXT,
ADD COLUMN "aad" TEXT,
ADD COLUMN "encryptionVersion" INTEGER;
