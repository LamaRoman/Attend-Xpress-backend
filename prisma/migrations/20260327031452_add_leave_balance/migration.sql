-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "annualLeaveEntitlement" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "casualLeaveEntitlement" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "leaveBalanceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sickLeaveEntitlement" INTEGER NOT NULL DEFAULT 12;

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bsYear" INTEGER NOT NULL,
    "annualEntitlement" INTEGER NOT NULL,
    "sickEntitlement" INTEGER NOT NULL,
    "casualEntitlement" INTEGER NOT NULL,
    "annualCarriedOver" INTEGER NOT NULL DEFAULT 0,
    "sickCarriedOver" INTEGER NOT NULL DEFAULT 0,
    "casualCarriedOver" INTEGER NOT NULL DEFAULT 0,
    "annualUsed" INTEGER NOT NULL DEFAULT 0,
    "sickUsed" INTEGER NOT NULL DEFAULT 0,
    "casualUsed" INTEGER NOT NULL DEFAULT 0,
    "lastAdjustedBy" TEXT,
    "lastAdjustedAt" TIMESTAMP(3),
    "adjustmentNote" TEXT,
    "initializedBy" TEXT,
    "initializedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_balances_organizationId_idx" ON "leave_balances"("organizationId");

-- CreateIndex
CREATE INDEX "leave_balances_organizationId_bsYear_idx" ON "leave_balances"("organizationId", "bsYear");

-- CreateIndex
CREATE INDEX "leave_balances_membershipId_idx" ON "leave_balances"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_membershipId_bsYear_key" ON "leave_balances"("membershipId", "bsYear");

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
