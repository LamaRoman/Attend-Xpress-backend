import { z } from 'zod';

const latField = z.number().min(-90).max(90);
const lngField = z.number().min(-180).max(180);
const radiusField = z.number().int().positive().max(10000); // meters; 10km hard cap

/**
 * Create a branch. SUPER_ADMIN only.
 * organizationId is required in body — super admin can target any org.
 */
export const createBranchSchema = z.object({
  organizationId: z.string().uuid('Invalid organizationId'),
  name: z.string().min(1, 'Branch name is required').trim().max(100),
  address: z.string().trim().max(500).optional(),
  isMain: z.boolean().optional(), // only used when creating a fresh org's main branch
  officeLat: latField.optional(),
  officeLng: lngField.optional(),
  geofenceRadius: radiusField.optional(),
});

/**
 * Update a branch. SUPER_ADMIN only.
 * All fields optional. organizationId is not editable.
 * isMain is intentionally NOT updatable to avoid accidentally orphaning the
 * org's main branch — to change which branch is "main", create a new one
 * with isMain=true and delete the old one (handled separately).
 */
export const updateBranchSchema = z.object({
  name: z.string().min(1).trim().max(100).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  officeLat: latField.nullable().optional(),
  officeLng: lngField.nullable().optional(),
  geofenceRadius: radiusField.nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Phase 9 — geofence-only update for ORG_ADMIN.
 *
 * ORG_ADMIN can adjust the geofence (lat/lng/radius) for any branch in their
 * own org, but cannot rename branches, change address, toggle isActive, or
 * touch organizationId. Those remain SUPER_ADMIN-only via updateBranchSchema.
 *
 * Note: all three fields are independently optional and `nullable` — passing
 * `null` clears that override and the branch falls back to org-level geofence
 * (per the resolveGeofenceConfig rules from Phase 5).
 */
export const updateBranchGeofenceSchema = z.object({
  officeLat: latField.nullable().optional(),
  officeLng: lngField.nullable().optional(),
  geofenceRadius: radiusField.nullable().optional(),
});

export const branchIdParamSchema = z.object({
  id: z.string().uuid('Invalid branch ID'),
});

/**
 * Super admin can filter the all-branches list by organization.
 */
export const listBranchesQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  includeInactive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type UpdateBranchGeofenceInput = z.infer<typeof updateBranchGeofenceSchema>;
export type ListBranchesQuery = z.infer<typeof listBranchesQuerySchema>;
