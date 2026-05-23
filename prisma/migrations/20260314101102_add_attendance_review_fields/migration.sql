-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByAccountant" BOOLEAN NOT NULL DEFAULT false;
