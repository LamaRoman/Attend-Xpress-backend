-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "dashainBonusMonth" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "dashainBonusPercent" INTEGER NOT NULL DEFAULT 100;
