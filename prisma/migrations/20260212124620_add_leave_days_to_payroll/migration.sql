-- AlterTable
ALTER TABLE "payroll_records" ADD COLUMN     "paidLeaveDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unpaidLeaveDays" INTEGER NOT NULL DEFAULT 0;
