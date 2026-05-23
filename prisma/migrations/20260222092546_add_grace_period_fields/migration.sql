-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'GRACE_PERIOD';

-- AlterTable
ALTER TABLE "org_subscriptions" ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "gracePeriodReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pricing_plans" ADD COLUMN     "gracePeriodDays" INTEGER NOT NULL DEFAULT 7;
