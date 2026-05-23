-- AlterTable
ALTER TABLE "payroll_records" ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "previousNetSalary" DECIMAL(12,2),
ADD COLUMN     "regeneratedAt" TIMESTAMP(3),
ADD COLUMN     "regeneratedBy" TEXT,
ADD COLUMN     "regeneratedFromPaid" BOOLEAN NOT NULL DEFAULT false;
