import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { Router, Response, NextFunction } from 'express';
import { leaveService } from '../services/leave.service';
import { validate } from '../middleware/validate';
import { createLeaveSchema, approveRejectLeaveSchema, leaveListQuerySchema } from '../schemas/leave.schema';
import { authenticate, requireOrgAdmin, requireOrgAdminOrAccountant, enforceOrgIsolation, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/feature.guard';

const router = Router();

router.use(authenticate);
router.use(requireFeature('featureLeave'));

// ===== Employee routes =====

// GET /api/leaves/balance — My leave balance for current BS year
router.get('/balance', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const membershipId = req.user!.membershipId;
    if (!membershipId) {
      return res.status(400).json({ error: { message: 'No active membership' } });
    }

    const bsYear = 2082;
    const startOfYear = new Date('2025-04-14'); // BS 2082 Baisakh 1
    const endOfYear = new Date('2026-04-13');   // BS 2082 Chaitra end

    const entitlements: Record<string, number> = {
      SICK: 12, CASUAL: 6, ANNUAL: 18, MATERNITY: 98, PATERNITY: 15, UNPAID: 365,
    };

    // All leave queries scoped to membershipId — confirmed field on Leave in schema
    const leaves = await prisma.leave.findMany({
      where: {
        membershipId,
        status: 'APPROVED',
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear },
      },
    });

    const used: Record<string, number> = { SICK: 0, CASUAL: 0, ANNUAL: 0, MATERNITY: 0, PATERNITY: 0, UNPAID: 0 };
    for (const l of leaves) {
      const days = Math.ceil((l.endDate.getTime() - l.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (used[l.type] !== undefined) used[l.type] += days;
    }

    const balance = Object.keys(entitlements).map((type) => ({
      type,
      entitled: entitlements[type],
      used: used[type] || 0,
      remaining: entitlements[type] - (used[type] || 0),
    }));

    const pending = await prisma.leave.count({ where: { membershipId, status: 'PENDING' } });

    res.json({ data: { bsYear, balance, pendingRequests: pending } });
  } catch (error) {
    next(error);
  }
});

// POST /api/leaves — Request leave
router.post('/', validate(createLeaveSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await leaveService.requestLeave(req.body, req.user!);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/leaves/my — My leave requests
router.get('/my', validate(leaveListQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { limit, offset, status } = req.query as any;
    const result = await leaveService.getMyLeaves(req.user!, limit, offset, status);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/leaves/:id — Cancel my pending leave
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await leaveService.cancelLeave(String(req.params.id), req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// ===== Admin / Accountant routes =====

// GET /api/leaves — List all leaves (admin + accountant, org-scoped)
router.get(
  '/',
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  validate(leaveListQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, status, userId, type, fromDate, toDate, search, bsYear, bsMonth, branchId } = req.query as any;
      const result = await leaveService.listLeaves(req.user!, limit, offset, {
        status,
        userId,
        type,
        fromDate,
        toDate,
        search,
        bsYear: bsYear ? Number(bsYear) : undefined,
        bsMonth: bsMonth ? Number(bsMonth) : undefined,
        branchId,
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/leaves/:id/status — Approve or reject leave (admin)
router.put(
  '/:id/status',
  requireOrgAdmin,
  enforceOrgIsolation,
  validate(approveRejectLeaveSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await leaveService.updateLeaveStatus(String(req.params.id), req.body.status, req.user!, req.body.rejectionMessage);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;