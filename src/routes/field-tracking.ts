import { Router, Response, NextFunction } from 'express';
import { fieldTrackingService } from '../services/field-tracking.service';
import { validate } from '../middleware/validate';
import { locationPingSchema, routeQuerySchema } from '../schemas/field-tracking.schema';
import {
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  AuthRequest,
} from '../middleware/auth';
import { pingRateLimiter } from '../middleware/rateLimiter';
import { getBranchScope } from '../lib/branch-scope';

const router = Router();

// POST /api/field-tracking/ping
// Called by the mobile app (or any authenticated client) every ~10 seconds.
// Employee must be isFieldStaff=true and currently CHECKED_IN.
router.post(
  '/ping',
  pingRateLimiter,
  authenticate,
  enforceOrgIsolation,
  validate(locationPingSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await fieldTrackingService.recordPing(req.body, req.user!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/field-tracking/live
// Admin only — returns latest ping for every currently clocked-in field staff member.
router.get(
  '/live',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const scope = getBranchScope(req.user);
      const positions = await fieldTrackingService.getLivePositions(
        req.user!.organizationId!,
        scope.branchId,
      );
      res.json({ data: positions });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/field-tracking/route?membershipId=...&date=YYYY-MM-DD
// Admin only — returns ordered pings for a specific employee on a specific date.
router.get(
  '/route',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  validate(routeQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { membershipId, date } = req.query as { membershipId: string; date: string };
      const route = await fieldTrackingService.getRoute(membershipId, date, req.user!);
      res.json({ data: route });
    } catch (error) {
      next(error);
    }
  }
);

export default router;