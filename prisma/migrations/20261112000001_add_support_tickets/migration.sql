CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "adminReply" TEXT,
  "repliedAt" TIMESTAMP(3),
  "repliedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_tickets_userId_idx" ON "support_tickets"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_userId_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
