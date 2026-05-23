import { Router, Response, NextFunction } from 'express';
import { rosterService } from '../services/roster.service';
import { validate } from '../middleware/validate';
import {
  createRosterScheduleSchema,
  updateRosterScheduleSchema,
  listRosterSchedulesQuerySchema,
  resolveRosterQuerySchema,
} from '../schemas/roster.schema';
import {
  authenticate,
  requireOrgAdmin,
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  AuthRequest,
} from '../middleware/auth';

const router = Router();

// All roster routes require authentication + org isolation
router.use(authenticate, enforceOrgIsolation);

// ============================================================
// Read-only routes (admin + accountant)
// ============================================================

// GET /api/v1/roster
// List all roster schedules for the org.
// ?scope=org|employee  ?membershipId=<uuid>  ?includeDeleted=true
router.get(
  '/',
  requireOrgAdminOrAccountant,
  validate(listRosterSchedulesQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const membershipId = req.query.membershipId as string | undefined
      const scope = req.query.scope as 'org' | 'employee' | undefined
      const includeDeleted = req.query.includeDeleted === 'true'
      const branchId = req.query.branchId as string | undefined
      const data = await rosterService.listSchedules(req.user!, { membershipId, scope, includeDeleted, branchId });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/v1/roster/resolve?membershipId=<uuid>&date=YYYY-MM-DD
// Returns the effective schedule (with source) for a given employee on a given date.
router.get(
  '/resolve',
  requireOrgAdminOrAccountant,
  validate(resolveRosterQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const membershipId = req.query.membershipId as string
      const date = req.query.date as string
      const data = await rosterService.resolveSchedule(membershipId, date, req.user!);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/v1/roster/:id
router.get(
  '/:id',
  requireOrgAdminOrAccountant,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await rosterService.getSchedule(String(req.params.id), req.user!);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================
// Mutating routes (org admin only)
// ============================================================

// POST /api/v1/roster
router.post(
  '/',
  requireOrgAdmin,
  validate(createRosterScheduleSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await rosterService.createSchedule(req.body, req.user!);
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /api/v1/roster/:id
router.put(
  '/:id',
  requireOrgAdmin,
  validate(updateRosterScheduleSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await rosterService.updateSchedule(String(req.params.id), req.body, req.user!);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/v1/roster/:id
router.delete(
  '/:id',
  requireOrgAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await rosterService.deleteSchedule(String(req.params.id), req.user!);
      res.json({ data: { message: 'Schedule deleted' } });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
