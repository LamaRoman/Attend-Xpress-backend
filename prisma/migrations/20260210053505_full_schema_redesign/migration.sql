/*
  Warnings:

  - The values [USER] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `attendance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payroll_settings` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[bsYear,bsMonth,bsDay,organizationId]` on the table `holidays` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `bsDay` to the `holidays` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bsMonth` to the `holidays` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bsYear` to the `holidays` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `leaves` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AttendanceAction" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceRecordStatus" AS ENUM ('CHECKED_IN', 'CHECKED_OUT', 'AUTO_CLOSED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "QRCodeStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'PROCESSED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('PUBLIC_HOLIDAY', 'RESTRICTED_HOLIDAY', 'ORGANIZATION_HOLIDAY');

-- CreateEnum
CREATE TYPE "CalendarMode" AS ENUM ('NEPALI', 'ENGLISH');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'EMPLOYEE');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';
COMMIT;

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_userId_fkey";

-- DropForeignKey
ALTER TABLE "payroll_settings" DROP CONSTRAINT "payroll_settings_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "payroll_settings" DROP CONSTRAINT "payroll_settings_userId_fkey";

-- AlterTable
ALTER TABLE "holidays" ADD COLUMN     "bsDay" INTEGER NOT NULL,
ADD COLUMN     "bsMonth" INTEGER NOT NULL,
ADD COLUMN     "bsYear" INTEGER NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameNepali" TEXT,
ADD COLUMN     "type" "HolidayType" NOT NULL DEFAULT 'PUBLIC_HOLIDAY';

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "bsEndDay" INTEGER,
ADD COLUMN     "bsEndMonth" INTEGER,
ADD COLUMN     "bsEndYear" INTEGER,
ADD COLUMN     "bsStartDay" INTEGER,
ADD COLUMN     "bsStartMonth" INTEGER,
ADD COLUMN     "bsStartYear" INTEGER,
ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "calendarMode" "CalendarMode" NOT NULL DEFAULT 'NEPALI';

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "isValid" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';

-- DropTable
DROP TABLE "attendance";

-- DropTable
DROP TABLE "payroll_settings";

-- DropEnum
DROP TYPE "AttendanceStatus";

-- CreateTable
CREATE TABLE "totp_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "totp_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "QRCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "totpDeviceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkInTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutTime" TIMESTAMP(3),
    "checkInMethod" "CheckInMethod" NOT NULL DEFAULT 'QR_SCAN',
    "checkOutMethod" "CheckInMethod",
    "duration" INTEGER,
    "status" "AttendanceRecordStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "qrCodeId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bsYear" INTEGER,
    "bsMonth" INTEGER,
    "bsDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_audit_log" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "totpDeviceId" TEXT,
    "qrToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_pay_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL,
    "dearnessAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "medicalAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ssfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "employeeSsfRate" DECIMAL(5,2) NOT NULL DEFAULT 11,
    "employerSsfRate" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "tdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pay_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "bsYear" INTEGER NOT NULL,
    "bsMonth" INTEGER NOT NULL,
    "workingDaysInMonth" INTEGER NOT NULL,
    "holidaysInMonth" INTEGER NOT NULL DEFAULT 0,
    "daysPresent" INTEGER NOT NULL,
    "daysAbsent" INTEGER NOT NULL,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "basicSalary" DECIMAL(12,2) NOT NULL,
    "dearnessAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "medicalAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(12,2) NOT NULL,
    "absenceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employeeSsf" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerSsf" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(12,2) NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "processedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "totp_devices_organizationId_idx" ON "totp_devices"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "qr_codes_organizationId_idx" ON "qr_codes"("organizationId");

-- CreateIndex
CREATE INDEX "qr_codes_token_idx" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "attendance_records_userId_idx" ON "attendance_records"("userId");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_idx" ON "attendance_records"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_records_checkInTime_idx" ON "attendance_records"("checkInTime");

-- CreateIndex
CREATE INDEX "attendance_records_userId_checkInTime_idx" ON "attendance_records"("userId", "checkInTime");

-- CreateIndex
CREATE INDEX "attendance_records_bsYear_bsMonth_idx" ON "attendance_records"("bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "attendance_audit_log_userId_idx" ON "attendance_audit_log"("userId");

-- CreateIndex
CREATE INDEX "attendance_audit_log_organizationId_idx" ON "attendance_audit_log"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_audit_log_createdAt_idx" ON "attendance_audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "attendance_audit_log_ipAddress_idx" ON "attendance_audit_log"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "employee_pay_settings_userId_key" ON "employee_pay_settings"("userId");

-- CreateIndex
CREATE INDEX "employee_pay_settings_organizationId_idx" ON "employee_pay_settings"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_records_organizationId_idx" ON "payroll_records"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_records_bsYear_bsMonth_idx" ON "payroll_records"("bsYear", "bsMonth");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_userId_bsYear_bsMonth_key" ON "payroll_records"("userId", "bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "system_configs_organizationId_idx" ON "system_configs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_organizationId_key_key" ON "system_configs"("organizationId", "key");

-- CreateIndex
CREATE INDEX "holidays_bsYear_bsMonth_idx" ON "holidays"("bsYear", "bsMonth");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_bsYear_bsMonth_bsDay_organizationId_key" ON "holidays"("bsYear", "bsMonth", "bsDay", "organizationId");

-- CreateIndex
CREATE INDEX "leaves_organizationId_idx" ON "leaves"("organizationId");

-- AddForeignKey
ALTER TABLE "totp_devices" ADD CONSTRAINT "totp_devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_totpDeviceId_fkey" FOREIGN KEY ("totpDeviceId") REFERENCES "totp_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_settings" ADD CONSTRAINT "employee_pay_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_settings" ADD CONSTRAINT "employee_pay_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
