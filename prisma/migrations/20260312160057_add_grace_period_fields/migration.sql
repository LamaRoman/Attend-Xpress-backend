-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "earlyClockInGraceMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "lateClockOutGraceMinutes" INTEGER NOT NULL DEFAULT 30;
