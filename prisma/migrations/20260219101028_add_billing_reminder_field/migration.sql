/*
  Warnings:

  - You are about to drop the column `conversionNudgeSentAt` on the `org_subscriptions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "org_subscriptions" DROP COLUMN "conversionNudgeSentAt",
ADD COLUMN     "billingReminderSentAt" TIMESTAMP(3);
