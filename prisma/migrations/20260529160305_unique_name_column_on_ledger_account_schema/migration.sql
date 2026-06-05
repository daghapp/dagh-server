/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `LedgerAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_name_key" ON "LedgerAccount"("name");
