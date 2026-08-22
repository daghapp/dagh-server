-- CreateEnum
CREATE TYPE "AdminDepartment" AS ENUM ('DIASPORA_AFFAIRS', 'OPERATIONS', 'VISA', 'TOURS', 'FINANCE', 'LEGAL', 'MARKETING', 'MODERATION', 'CUSTOMER_SUPPORT', 'IT_SUPPORT');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VISA_OFFICER', 'TOUR_MANAGER', 'FINANCE', 'SUPPORT', 'MODERATOR');

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "department" "AdminDepartment" NOT NULL,
    "role" "AdminRole" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_userId_key" ON "admin_profiles"("userId");

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
