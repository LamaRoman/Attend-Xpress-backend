/*
  Warnings:

  - You are about to drop the column `holidaySyncEnabled` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `leaveEnabled` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `payrollEnabled` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `reportsEnabled` on the `organizations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "holidaySyncEnabled",
DROP COLUMN "leaveEnabled",
DROP COLUMN "payrollEnabled",
DROP COLUMN "reportsEnabled";
