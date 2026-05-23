-- Add isFieldStaff flag to org_memberships
ALTER TABLE "org_memberships" ADD COLUMN "isFieldStaff" BOOLEAN NOT NULL DEFAULT false;

-- Create location_pings table
CREATE TABLE "location_pings" (
  "id"                 TEXT NOT NULL,
  "membershipId"       TEXT NOT NULL,
  "attendanceRecordId" TEXT,
  "organizationId"     TEXT NOT NULL,
  "lat"                DOUBLE PRECISION NOT NULL,
  "lng"                DOUBLE PRECISION NOT NULL,
  "accuracy"           DOUBLE PRECISION,
  "recordedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "location_pings_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_attendanceRecordId_fkey"
  FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "location_pings_membershipId_recordedAt_idx" ON "location_pings"("membershipId", "recordedAt");
CREATE INDEX "location_pings_organizationId_recordedAt_idx" ON "location_pings"("organizationId", "recordedAt");
CREATE INDEX "location_pings_attendanceRecordId_idx" ON "location_pings"("attendanceRecordId");
