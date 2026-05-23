-- CreateTable
CREATE TABLE "payroll_audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payrollRecordId" TEXT,
    "employeeUserId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "reason" TEXT,
    "attendanceRecordId" TEXT,
    "bsYear" INTEGER,
    "bsMonth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_audit_logs_organizationId_idx" ON "payroll_audit_logs"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_audit_logs_payrollRecordId_idx" ON "payroll_audit_logs"("payrollRecordId");

-- CreateIndex
CREATE INDEX "payroll_audit_logs_employeeUserId_idx" ON "payroll_audit_logs"("employeeUserId");

-- AddForeignKey
ALTER TABLE "payroll_audit_logs" ADD CONSTRAINT "payroll_audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
