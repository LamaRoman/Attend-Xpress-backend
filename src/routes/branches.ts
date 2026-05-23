import { Router, Response, NextFunction } from 'express';
import { branchService } from '../services/branch.service';
import {
  authenticate,
  requireOrgAdmin,
  requireOrgAdminStrict,
  enforceOrgIsolation,
  AuthRequest,
} from '../middleware/auth';
import { validate } from '../middleware/validate';
import { branchIdParamSchema, updateBranchGeofenceSchema } from '../schemas/branch.schema';
import { getBranchScope } from '../lib/branch-scope';

const router = Router();

// GET /api/branches
// ORG_ADMIN, ORG_ACCOUNTANT, and BRANCH_ADMIN — lists branches visible to them.
// ORG_ADMIN gets all branches in their org. BRANCH_ADMIN gets only their own
// branch, so the Add Employee form's branch picker and the field-tracking
// branch filter on the frontend automatically render the right options.
router.get(
  '/',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          error: { message: 'organizationId required', code: 'NO_ORG_CONTEXT' },
        });
      }
      // Phase 8b — archived branch access. Only ORG_ADMIN can request
      // soft-deleted branches; BRANCH_ADMIN and ORG_ACCOUNTANT silently get
      // the active-only list regardless of the query param.
      const includeDeleted =
        req.query.includeDeleted === 'true' && req.user!.role === 'ORG_ADMIN';
      const all = await branchService.listForOrganization(organizationId, false, includeDeleted);
      const scope = getBranchScope(req.user);
      const branches = scope.branchId
        ? all.filter((b: { id: string }) => b.id === scope.branchId)
        : all;
      res.json({ data: branches });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /api/v1/branches/:id/geofence
// Phase 9 — ORG_ADMIN edits geofence (lat/lng/radius) for any branch in their
// own org. Strict ORG_ADMIN: BRANCH_ADMIN is rejected (conflict of interest —
// they shouldn't be able to edit the rule that measures their own staff).
// Org-isolation is enforced inside the service via the `organizationId` check.
router.put(
  '/:id/geofence',
  authenticate,
  requireOrgAdminStrict,
  enforceOrgIsolation,
  validate(branchIdParamSchema, 'params'),
  validate(updateBranchGeofenceSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const branch = await branchService.updateGeofence(
        String(req.params.id),
        req.user!,
        req.body,
      );
      res.json({ data: branch });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
