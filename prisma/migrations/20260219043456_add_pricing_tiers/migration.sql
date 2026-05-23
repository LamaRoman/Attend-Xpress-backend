-- CreateEnum
CREATE TYPE "TierName" AS ENUM ('STARTER', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateTable
CREATE TABLE "pricing_plans" (
    "id" TEXT NOT NULL,
    "tier" "TierName" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "pricePerEmployee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NPR',
    "maxEmployees" INTEGER,
    "hardEmployeeCap" INTEGER,
    "trialDaysMonthly" INTEGER NOT NULL DEFAULT 30,
    "trialDaysAnnual" INTEGER NOT NULL DEFAULT 90,
    "annualDiscountMonths" INTEGER NOT NULL DEFAULT 2,
    "featureTotp" BOOLEAN NOT NULL DEFAULT false,
    "featureLeave" BOOLEAN NOT NULL DEFAULT false,
    "featureManualCorrection" BOOLEAN NOT NULL DEFAULT false,
    "featureFullPayroll" BOOLEAN NOT NULL DEFAULT false,
    "featurePayrollWorkflow" BOOLEAN NOT NULL DEFAULT false,
    "featureReports" BOOLEAN NOT NULL DEFAULT false,
    "featureNotifications" BOOLEAN NOT NULL DEFAULT false,
    "featureOnboarding" BOOLEAN NOT NULL DEFAULT false,
    "featureAuditLog" BOOLEAN NOT NULL DEFAULT false,
    "auditLogRetentionDays" INTEGER,
    "featureFileDownload" BOOLEAN NOT NULL DEFAULT false,
    "featureDownloadReports" BOOLEAN NOT NULL DEFAULT false,
    "featureDownloadPayslips" BOOLEAN NOT NULL DEFAULT false,
    "featureDownloadAuditLog" BOOLEAN NOT NULL DEFAULT false,
    "featureDownloadLeaveRecords" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_admin_notes" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "isTrialUsed" BOOLEAN NOT NULL DEFAULT false,
    "trialReminderSentAt" TIMESTAMP(3),
    "trialFinalReminderAt" TIMESTAMP(3),
    "conversionNudgeSentAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "currentEmployeeCount" INTEGER NOT NULL DEFAULT 0,
    "customPricePerEmployee" DECIMAL(10,2),
    "customMaxEmployees" INTEGER,
    "isPriceLockedForever" BOOLEAN NOT NULL DEFAULT false,
    "isFoundingMember" BOOLEAN NOT NULL DEFAULT false,
    "foundingMemberNote" TEXT,
    "setupFeePaid" BOOLEAN NOT NULL DEFAULT false,
    "setupFeeAmount" DECIMAL(10,2),
    "setupFeePaidAt" TIMESTAMP(3),
    "setupFeeWaived" BOOLEAN NOT NULL DEFAULT false,
    "setupFeeWaivedBy" TEXT,
    "setupFeeWaivedNote" TEXT,
    "parentSubscriptionId" TEXT,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_billing_log" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "performedBy" TEXT,
    "event" TEXT NOT NULL,
    "fromPlan" TEXT,
    "toPlan" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "amount" DECIMAL(10,2),
    "employeeCount" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_billing_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_plans_tier_key" ON "pricing_plans"("tier");

-- CreateIndex
CREATE INDEX "subscription_admin_notes_subscriptionId_idx" ON "subscription_admin_notes"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "org_subscriptions_organizationId_key" ON "org_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "org_subscriptions_organizationId_idx" ON "org_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "org_subscriptions_status_idx" ON "org_subscriptions"("status");

-- CreateIndex
CREATE INDEX "org_subscriptions_planId_idx" ON "org_subscriptions"("planId");

-- CreateIndex
CREATE INDEX "org_subscriptions_trialEndsAt_idx" ON "org_subscriptions"("trialEndsAt");

-- CreateIndex
CREATE INDEX "org_subscriptions_nextBillingDate_idx" ON "org_subscriptions"("nextBillingDate");

-- CreateIndex
CREATE INDEX "subscription_billing_log_subscriptionId_idx" ON "subscription_billing_log"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_billing_log_organizationId_idx" ON "subscription_billing_log"("organizationId");

-- CreateIndex
CREATE INDEX "subscription_billing_log_createdAt_idx" ON "subscription_billing_log"("createdAt");

-- AddForeignKey
ALTER TABLE "subscription_admin_notes" ADD CONSTRAINT "subscription_admin_notes_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "org_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "pricing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_parentSubscriptionId_fkey" FOREIGN KEY ("parentSubscriptionId") REFERENCES "org_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_billing_log" ADD CONSTRAINT "subscription_billing_log_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "org_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
