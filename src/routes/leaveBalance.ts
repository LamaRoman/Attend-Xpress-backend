import { Router, Response, NextFunction } from 'express';
import {
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  AuthRequest,
} from '../middleware/auth';
import { leaveBalanceService } from '../services/leaveBalance.service';

const router = Router();

// ── GET /api/leave-balance/my?bsYear=2082 ────────────────────────────────────
// Employee: get their own balance for a given BS year.
// Returns null (200) if leaveBalanceEnabled is false — frontend checks for null.
router.get(
  '/my',
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.membershipId || !req.user!.organizationId) {
        return res.status(400).json({ error: { message: 'No active membership' } });
      }

      const bsYear = Number(req.query.bsYear);
      if (!bsYear || isNaN(bsYear)) {
        return res.status(400).json({ error: { message: 'bsYear query param is required' } });
      }

      const balance = await leaveBalanceService.getMyBalance(
        req.user!.membershipId,
        req.user!.organizationId,
        bsYear
      );

      res.json({ data: balance }); // null if disabled or not initialized
    } catch (error) {
      next(error);
    }
  }
);

// ── GET /api/leave-balance?bsYear=2082 ───────────────────────────────────────
// Admin: get all employee balances for the org for a given BS year.
router.get(
  '/',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const bsYear = Number(req.query.bsYear);
      if (!bsYear || isNaN(bsYear)) {
        return res.status(400).json({ error: { message: 'bsYear query param is required' } });
      }

      const balances = await leaveBalanceService.getOrgBalances(
        req.user!.organizationId!,
        bsYear
      );

      res.json({ data: balances });
    } catch (error) {
      next(error);
    }
  }
);

// ── POST /api/leave-balance/initialize ───────────────────────────────────────
// Admin: initialize leave balances for all active employees for a BS year.
// Pass dryRun=true in body to preview without writing.
router.post(
  '/initialize',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { bsYear, dryRun = false } = req.body;

      if (!bsYear || isNaN(Number(bsYear))) {
        return res.status(400).json({ error: { message: 'bsYear is required' } });
      }

      const result = await leaveBalanceService.initializeYear(
        req.user!.organizationId!,
        Number(bsYear),
        req.user!.userId,
        Boolean(dryRun)
      );

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ── PATCH /api/leave-balance/:membershipId/adjust ────────────────────────────
// Admin: manually adjust a specific employee's leave balance for a BS year.
router.put(
  '/:membershipId/adjust',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const membershipId = String(req.params.membershipId);
      const { bsYear, note, ...adjustments } = req.body;

      if (!bsYear || isNaN(Number(bsYear))) {
        return res.status(400).json({ error: { message: 'bsYear is required' } });
      }

      if (!note || note.trim().length < 3) {
        return res.status(400).json({ error: { message: 'note is required (min 3 characters)' } });
      }

      const result = await leaveBalanceService.adjustBalance(
        req.user!.organizationId!,
        membershipId,
        Number(bsYear),
        adjustments,
        note,
        req.user!.userId
      );

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;