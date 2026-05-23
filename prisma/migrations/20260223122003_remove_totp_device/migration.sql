/*
  Warnings:

  - You are about to drop the column `totpDeviceId` on the `attendance_audit_log` table. All the data in the column will be lost.
  - You are about to drop the column `overrideFeatureTotp` on the `org_subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `featureTotp` on the `pricing_plans` table. All the data in the column will be lost.
  - You are about to drop the column `totpDeviceId` on the `qr_codes` table. All the data in the column will be lost.
  - You are about to drop the `totp_devices` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_totpDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "totp_devices" DROP CONSTRAINT "totp_devices_organizationId_fkey";

-- AlterTable
ALTER TABLE "attendance_audit_log" DROP COLUMN "totpDeviceId";

-- AlterTable
ALTER TABLE "org_subscriptions" DROP COLUMN "overrideFeatureTotp";

-- AlterTable
ALTER TABLE "pricing_plans" DROP COLUMN "featureTotp";

-- AlterTable
ALTER TABLE "qr_codes" DROP COLUMN "totpDeviceId";

-- DropTable
DROP TABLE "totp_devices";
