/*
  Warnings:

  - You are about to drop the column `annualDiscountMonths` on the `pricing_plans` table. All the data in the column will be lost.
  - You are about to drop the column `trialDaysAnnual` on the `pricing_plans` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "pricing_plans" DROP COLUMN "annualDiscountMonths",
DROP COLUMN "trialDaysAnnual";
