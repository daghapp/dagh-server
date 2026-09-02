-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN "bio_document_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_bio_document_number_key" ON "user_profiles"("bio_document_number");
