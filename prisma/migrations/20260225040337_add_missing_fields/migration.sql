-- AlterEnum
ALTER TYPE "PayrollStatus" ADD VALUE 'NEEDS_RECALCULATION';

-- AlterTable
ALTER TABLE "pricing_plans" ADD COLUMN     "featureTotp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "attendancePinHash" TEXT;
