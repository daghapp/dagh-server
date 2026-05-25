-- CreateTable
CREATE TABLE "hubtel_direct_receive_logs" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "responseCode" TEXT,
    "data" JSONB,
    "amount" DOUBLE PRECISION,
    "charges" DOUBLE PRECISION,
    "amountAfterCharges" DOUBLE PRECISION,
    "amountCharged" DOUBLE PRECISION,
    "description" TEXT,
    "clientReference" TEXT,
    "transactionId" TEXT,
    "externalTransactionId" TEXT,
    "orderId" TEXT,
    "deliveryFee" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubtel_direct_receive_logs_pkey" PRIMARY KEY ("id")
);
