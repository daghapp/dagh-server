-- AlterTable
ALTER TABLE "billing_history" ALTER COLUMN "paymentReference" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "paymentReference" DROP DEFAULT,
ALTER COLUMN "clientReference" DROP DEFAULT;
