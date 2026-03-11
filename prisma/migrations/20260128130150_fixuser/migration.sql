-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT,
    "platform" TEXT,
    "addedAt" TIMESTAMP(3),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
