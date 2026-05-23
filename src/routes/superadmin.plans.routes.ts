// src/routes/superadmin.plans.routes.ts
import { Router, Response, NextFunction } from 'express';
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();
router.use(authenticate, requireSuperAdmin);

// GET /api/super-admin/plans
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.pricingPlan.findMany({
      orderBy: { pricePerEmployee: 'asc' },
    });
    res.json({ data: plans });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/plans/:tier/features
router.patch('/:tier/features', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const allowedFields = [
      'featureLeave', 'featureManualCorrection',
      'featureFullPayroll', 'featurePayrollWorkflow', 'featureReports',
      'featureNotifications', 'featureOnboarding', 'featureAuditLog',
      'featureFileDownload', 'featureDownloadReports', 'featureDownloadPayslips',
      'featureDownloadAuditLog', 'featureDownloadLeaveRecords',
    ];
    const updates: Record<string, boolean> = {};
    for (const key of allowedFields) {
      if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: { code: 'NO_UPDATES', message: 'No valid feature flags provided.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({ where: { tier: tier as any }, data: updates });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/plans/:tier/price
router.patch('/:tier/price', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const { pricePerEmployee } = req.body;
    if (typeof pricePerEmployee !== 'number' || pricePerEmployee < 0) {
      res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'pricePerEmployee must be a non-negative number.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({ where: { tier: tier as any }, data: { pricePerEmployee } });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/plans/:tier/setup-fee
router.patch('/:tier/setup-fee', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const { defaultSetupFee } = req.body;
    if (defaultSetupFee !== null && (typeof defaultSetupFee !== 'number' || defaultSetupFee < 0)) {
      res.status(400).json({ error: { code: 'INVALID_SETUP_FEE', message: 'defaultSetupFee must be a non-negative number or null.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({ where: { tier: tier as any }, data: { defaultSetupFee: defaultSetupFee ?? null } });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/plans/:tier/trial-days
// Only monthly trial days -- annual billing is not supported
router.patch('/:tier/trial-days', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const { days } = req.body;
    if (typeof days !== 'number' || days < 0 || !Number.isInteger(days)) {
      res.status(400).json({ error: { code: 'INVALID_TRIAL_DAYS', message: 'days must be a non-negative integer. Set to 0 to disable trial.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({
      where: { tier: tier as any },
      data:  { trialDaysMonthly: days },
    });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/plans/:tier/grace-period
router.patch('/:tier/grace-period', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const { gracePeriodDays } = req.body;
    if (typeof gracePeriodDays !== 'number' || gracePeriodDays < 1 || !Number.isInteger(gracePeriodDays)) {
      res.status(400).json({ error: { code: 'INVALID_GRACE_PERIOD', message: 'gracePeriodDays must be a positive integer.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({ where: { tier: tier as any }, data: { gracePeriodDays } });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});


// PATCH /api/super-admin/plans/:tier/annual-discount
router.patch('/:tier/annual-discount', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.params;
    const { annualDiscountPercent } = req.body;
    if (typeof annualDiscountPercent !== 'number' || annualDiscountPercent < 0 || annualDiscountPercent > 100 || !Number.isInteger(annualDiscountPercent)) {
      res.status(400).json({ error: { code: 'INVALID_DISCOUNT', message: 'annualDiscountPercent must be an integer between 0 and 100.' } });
      return;
    }
    const plan = await prisma.pricingPlan.update({ where: { tier: tier as any }, data: { annualDiscountPercent } });
    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
});

export default router;

