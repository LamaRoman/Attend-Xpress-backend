-- CreateIndex
CREATE INDEX "attendance_records_organizationId_bsYear_bsMonth_idx" ON "attendance_records"("organizationId", "bsYear", "bsMonth");

-- CreateIndex
CREATE INDEX "attendance_records_userId_bsYear_bsMonth_idx" ON "attendance_records"("userId", "bsYear", "bsMonth");
