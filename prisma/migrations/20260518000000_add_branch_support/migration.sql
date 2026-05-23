-- ============================================================
-- Phase 1 — Multi-branch support
--
-- 1. Add BRANCH_ADMIN role
-- 2. Create branches table
-- 3. Add branchId to org_memberships
-- 4. Backfill: every existing org gets a Main Branch and every
--    existing membership is assigned to its org's Main Branch
-- ============================================================

-- 1. Add BRANCH_ADMIN to Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'BRANCH_ADMIN';

-- 2. Create branches table
CREATE TABLE "branches" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "address"        TEXT,
  "isMain"         BOOLEAN NOT NULL DEFAULT false,
  "officeLat"      DOUBLE PRECISION,
  "officeLng"      DOUBLE PRECISION,
  "geofenceRadius" INTEGER,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),

  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");
CREATE INDEX "branches_organizationId_isActive_idx" ON "branches"("organizationId", "isActive");

-- 3. Add branchId to org_memberships
ALTER TABLE "org_memberships" ADD COLUMN "branchId" TEXT;

ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "org_memberships_branchId_idx" ON "org_memberships"("branchId");

-- 4. Backfill: create a Main Branch for every existing org and assign
--    all existing memberships to it. Branch inherits the org's geofence
--    settings so behavior is unchanged immediately after migration.
DO $$
DECLARE
  org RECORD;
  new_branch_id TEXT;
BEGIN
  FOR org IN
    SELECT "id", "name", "officeLat", "officeLng", "geofenceRadius"
    FROM "organizations"
    WHERE "deletedAt" IS NULL
  LOOP
    new_branch_id := gen_random_uuid()::TEXT;

    INSERT INTO "branches" (
      "id", "organizationId", "name", "isMain",
      "officeLat", "officeLng", "geofenceRadius",
      "isActive", "createdAt", "updatedAt"
    ) VALUES (
      new_branch_id, org."id", 'Main Branch', true,
      org."officeLat", org."officeLng", org."geofenceRadius",
      true, NOW(), NOW()
    );

    UPDATE "org_memberships"
    SET "branchId" = new_branch_id
    WHERE "organizationId" = org."id"
      AND "branchId" IS NULL;
  END LOOP;
END $$;
