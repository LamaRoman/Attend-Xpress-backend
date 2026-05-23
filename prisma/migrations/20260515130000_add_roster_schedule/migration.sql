-- CreateEnum
CREATE TYPE "RosterCycleType" AS ENUM ('FIXED', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "roster_schedules" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId"   TEXT,
    "cycleType"      "RosterCycleType" NOT NULL,
    "workingDays"    TEXT NOT NULL,
    "workStartTime"  TEXT NOT NULL,
    "workEndTime"    TEXT NOT NULL,
    "effectiveFrom"  DATE NOT NULL,
    "effectiveTo"    DATE,
    "label"          TEXT,
    "createdBy"      TEXT NOT NULL,
    "updatedBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "deletedAt"      TIMESTAMP(3),

    CONSTRAINT "roster_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_schedules_organizationId_idx" ON "roster_schedules"("organizationId");
CREATE INDEX "roster_schedules_organizationId_membershipId_idx" ON "roster_schedules"("organizationId", "membershipId");
CREATE INDEX "roster_schedules_organizationId_effectiveFrom_effectiveTo_idx" ON "roster_schedules"("organizationId", "effectiveFrom", "effectiveTo");
CREATE INDEX "roster_schedules_membershipId_idx" ON "roster_schedules"("membershipId");

-- AddForeignKey
ALTER TABLE "roster_schedules" ADD CONSTRAINT "roster_schedules_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "roster_schedules" ADD CONSTRAINT "roster_schedules_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
