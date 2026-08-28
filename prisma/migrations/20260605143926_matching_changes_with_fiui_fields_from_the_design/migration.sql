/*
  Warnings:

  - You are about to drop the column `email` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `primary_place_of_stay` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - Added the required column `bio_page_image_url` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date_of_arrival` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date_of_departure` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `flight_itenary_image_url` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "visa_on_arrival_data" DROP COLUMN "email",
DROP COLUMN "phone",
DROP COLUMN "primary_place_of_stay",
ADD COLUMN     "bio_page_image_url" TEXT NOT NULL,
ADD COLUMN     "date_of_arrival" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "date_of_departure" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "flight_itenary_image_url" TEXT NOT NULL;
