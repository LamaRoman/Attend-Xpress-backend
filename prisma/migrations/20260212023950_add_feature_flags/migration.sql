-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "holidaySyncEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "leaveEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reportsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rotatingQREnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staticQREnabled" BOOLEAN NOT NULL DEFAULT true;
