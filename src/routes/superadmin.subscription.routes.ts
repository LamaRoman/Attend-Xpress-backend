// src/routes/superadmin.subscription.routes.ts
import { Router, Response, NextFunction } from 'express';
import prisma from "../lib/prisma";
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { superAdminSubscriptionService } from '../services/superadmin.subscription.service';
import { runTrialExpiryJob } from '../jobs/trial-expiry.job';
import {
  orgIdParamSchema,
  listOrgsQuerySchema,
  assignTierSchema,
  overridePricingSchema,
  waiveSetupFeeSchema,
  suspendSchema,
  reactivateSchema,
  addNoteSchema,
} from '../schemas/superadmin.subscription.schema';
import { z } from 'zod';

const router = Router();

router.use(authenticate, requireSuperAdmin);

// Inline schema for mark-expired -- reason required, same pattern as suspend
const markExpiredSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
});

// ── Non-param routes FIRST (must be before /:organizationId to avoid param capture) ──

// GET /api/super-admin/subscriptions
router.get('/', validate(listOrgsQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.listSubscriptions(req.query as any);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/subscriptions/run-trial-job
router.post('/run-trial-job', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await runTrialExpiryJob();
    res.json({ data: { message: 'Trial expiry job completed successfully' } });
  } catch (error) {
    next(error);
  }
});

// ── Param routes below ──

// GET /api/super-admin/subscriptions/:organizationId
router.get('/:organizationId', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.getSubscription(String(req.params.organizationId));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/subscriptions/:organizationId/assign-tier
router.post('/:organizationId/assign-tier', validate(orgIdParamSchema, 'params'), validate(assignTierSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.assignTier(String(req.params.organizationId), req.body, req.user!);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/override-pricing
router.patch('/:organizationId/override-pricing', validate(orgIdParamSchema, 'params'), validate(overridePricingSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.overridePricing(String(req.params.organizationId), req.body, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/waive-setup-fee
router.patch('/:organizationId/waive-setup-fee', validate(orgIdParamSchema, 'params'), validate(waiveSetupFeeSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.waiveSetupFee(String(req.params.organizationId), req.body, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/suspend
router.patch('/:organizationId/suspend', validate(orgIdParamSchema, 'params'), validate(suspendSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.suspendSubscription(String(req.params.organizationId), req.body, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/extend-trial
// Only works for TRIALING or GRACE_PERIOD subscriptions.
// Adds N days to trialEndsAt. If in GRACE_PERIOD, resets back to TRIALING.
router.patch('/:organizationId/extend-trial', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days, note } = req.body;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'days must be an integer between 1 and 365.' } });
      return;
    }
    const result = await superAdminSubscriptionService.extendTrial(String(req.params.organizationId), { days, note }, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/mark-expired
// Only SUSPENDED subscriptions can be manually expired.
// Use when an org has explicitly cancelled or will not return.
router.patch('/:organizationId/mark-expired', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = markExpiredSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message } });
      return;
    }
    const result = await superAdminSubscriptionService.markAsExpired(String(req.params.organizationId), parsed.data, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/reactivate
router.patch('/:organizationId/reactivate', validate(orgIdParamSchema, 'params'), validate(reactivateSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.reactivateSubscription(String(req.params.organizationId), req.body, req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/subscriptions/:organizationId/notes
router.post('/:organizationId/notes', validate(orgIdParamSchema, 'params'), validate(addNoteSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.addNote(String(req.params.organizationId), req.body, req.user!);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/subscriptions/:organizationId/billing-log
router.get('/:organizationId/billing-log', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminSubscriptionService.getBillingLog(String(req.params.organizationId));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/subscriptions/:organizationId/feature-overrides
router.patch('/:organizationId/feature-overrides', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = String(req.params.organizationId);
    const allowedFields = [
      'overrideFeatureLeave', 'overrideFeatureManualCorrection',
      'overrideFeatureFullPayroll', 'overrideFeaturePayrollWorkflow', 'overrideFeatureReports',
      'overrideFeatureNotifications', 'overrideFeatureOnboarding', 'overrideFeatureAuditLog',
      'overrideFeatureFileDownload', 'overrideFeatureDownloadReports', 'overrideFeatureDownloadPayslips',
      'overrideFeatureDownloadAuditLog', 'overrideFeatureDownloadLeaveRecords',
    ];
    const updates: Record<string, boolean | null> = {};
    for (const key of allowedFields) {
      if (req.body[key] === null || typeof req.body[key] === 'boolean') {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: { code: 'NO_UPDATES', message: 'No valid override fields provided.' } });
      return;
    }
    const sub = await prisma.orgSubscription.update({
      where: { organizationId },
      data: updates,
      include: { plan: true },
    });
    const { invalidatePlanCache } = require('../services/plan.service');
    invalidatePlanCache(organizationId);
    res.json({ data: sub });
  } catch (error) {
    next(error);
  }
});

export default router;