-- CreateIndex
CREATE INDEX "employee_pay_settings_userId_idx" ON "employee_pay_settings"("userId");

-- CreateIndex
CREATE INDEX "holidays_organizationId_bsYear_idx" ON "holidays"("organizationId", "bsYear");

-- CreateIndex
CREATE INDEX "leaves_userId_status_idx" ON "leaves"("userId", "status");

-- CreateIndex
CREATE INDEX "leaves_organizationId_status_idx" ON "leaves"("organizationId", "status");

-- CreateIndex
CREATE INDEX "leaves_startDate_endDate_idx" ON "leaves"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "payroll_records_userId_bsYear_bsMonth_idx" ON "payroll_records"("userId", "bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "payroll_records_organizationId_bsYear_bsMonth_idx" ON "payroll_records"("organizationId", "bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "payroll_records_status_idx" ON "payroll_records"("status");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_userId_isValid_idx" ON "user_sessions"("userId", "isValid");
