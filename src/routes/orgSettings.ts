import { Router, Response, NextFunction } from 'express';
import { orgSettingsService } from '../services/orgSettings.service';
import { authenticate, requireOrgAdminStrict, AuthRequest, enforceOrgIsolation } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();
router.use(authenticate);
router.use(requireOrgAdminStrict);
router.use(enforceOrgIsolation);

// GET /api/org-settings
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await orgSettingsService.getSettings(req.user!);
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

// PUT /api/org-settings
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await orgSettingsService.updateSettings(req.user!, req.body);
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

// GET /api/org-settings/subscription
router.get('/subscription', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sub = await prisma.orgSubscription.findUnique({
      where: { organizationId: req.user!.organizationId! },
      include: { plan: true },
    });
    res.json({ data: sub });
  } catch (e) {
    next(e);
  }
});

export default router;