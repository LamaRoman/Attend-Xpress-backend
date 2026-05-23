/*
  Warnings:

  - You are about to drop the column `userId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `attendance_records` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `employee_documents` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `employee_pay_settings` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `leaves` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `payroll_records` table. All the data in the column will be lost.
  - You are about to drop the column `createdById` on the `qr_codes` table. All the data in the column will be lost.
  - You are about to drop the column `attendancePinHash` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `employeeId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `panNumber` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `shiftEndTime` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `shiftStartTime` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[membershipId]` on the table `employee_pay_settings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[membershipId,bsYear,bsMonth]` on the table `payroll_records` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `membershipId` to the `attendance_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `membershipId` to the `employee_documents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `membershipId` to the `employee_pay_settings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `membershipId` to the `leaves` table without a default value. This is not possible if the table is not empty.
  - Added the required column `membershipId` to the `payroll_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdByMembershipId` to the `qr_codes` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "employee_documents" DROP CONSTRAINT "employee_documents_userId_fkey";

-- DropForeignKey
ALTER TABLE "employee_pay_settings" DROP CONSTRAINT "employee_pay_settings_userId_fkey";

-- DropForeignKey
ALTER TABLE "leaves" DROP CONSTRAINT "leaves_userId_fkey";

-- DropForeignKey
ALTER TABLE "payroll_records" DROP CONSTRAINT "payroll_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_createdById_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- DropIndex
DROP INDEX "Notification_userId_idx";

-- DropIndex
DROP INDEX "attendance_records_userId_bsYear_bsMonth_idx";

-- DropIndex
DROP INDEX "attendance_records_userId_checkInTime_idx";

-- DropIndex
DROP INDEX "attendance_records_userId_idx";

-- DropIndex
DROP INDEX "employee_documents_userId_idx";

-- DropIndex
DROP INDEX "employee_pay_settings_userId_idx";

-- DropIndex
DROP INDEX "employee_pay_settings_userId_key";

-- DropIndex
DROP INDEX "leaves_userId_idx";

-- DropIndex
DROP INDEX "leaves_userId_status_idx";

-- DropIndex
DROP INDEX "payroll_records_userId_bsYear_bsMonth_idx";

-- DropIndex
DROP INDEX "payroll_records_userId_bsYear_bsMonth_key";

-- DropIndex
DROP INDEX "users_employeeId_key";

-- DropIndex
DROP INDEX "users_organizationId_idx";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "attendance_records" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "employee_documents" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "employee_pay_settings" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "leaves" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payroll_records" DROP COLUMN "userId",
ADD COLUMN     "membershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "qr_codes" DROP COLUMN "createdById",
ADD COLUMN     "createdByMembershipId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "attendancePinHash",
DROP COLUMN "employeeId",
DROP COLUMN "organizationId",
DROP COLUMN "panNumber",
DROP COLUMN "shiftEndTime",
DROP COLUMN "shiftStartTime";

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeId" TEXT,
    "attendancePinHash" TEXT,
    "panNumber" TEXT,
    "shiftStartTime" TEXT,
    "shiftEndTime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_memberships_userId_idx" ON "org_memberships"("userId");

-- CreateIndex
CREATE INDEX "org_memberships_organizationId_idx" ON "org_memberships"("organizationId");

-- CreateIndex
CREATE INDEX "org_memberships_organizationId_isActive_idx" ON "org_memberships"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "org_memberships_organizationId_role_idx" ON "org_memberships"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_userId_organizationId_key" ON "org_memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_organizationId_employeeId_key" ON "org_memberships"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "Notification_membershipId_idx" ON "Notification"("membershipId");

-- CreateIndex
CREATE INDEX "attendance_records_membershipId_idx" ON "attendance_records"("membershipId");

-- CreateIndex
CREATE INDEX "attendance_records_membershipId_checkInTime_idx" ON "attendance_records"("membershipId", "checkInTime");

-- CreateIndex
CREATE INDEX "attendance_records_membershipId_bsYear_bsMonth_idx" ON "attendance_records"("membershipId", "bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "employee_documents_membershipId_idx" ON "employee_documents"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_pay_settings_membershipId_key" ON "employee_pay_settings"("membershipId");

-- CreateIndex
CREATE INDEX "employee_pay_settings_membershipId_idx" ON "employee_pay_settings"("membershipId");

-- CreateIndex
CREATE INDEX "leaves_membershipId_idx" ON "leaves"("membershipId");

-- CreateIndex
CREATE INDEX "leaves_membershipId_status_idx" ON "leaves"("membershipId", "status");

-- CreateIndex
CREATE INDEX "payroll_records_membershipId_bsYear_bsMonth_idx" ON "payroll_records"("membershipId", "bsYear", "bsMonth");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_records_membershipId_bsYear_bsMonth_key" ON "payroll_records"("membershipId", "bsYear", "bsMonth");

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_settings" ADD CONSTRAINT "employee_pay_settings_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
