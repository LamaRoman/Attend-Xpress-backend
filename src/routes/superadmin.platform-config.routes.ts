// src/routes/superadmin.platform-config.routes.ts
// ============================================================
// Super admin endpoints for reading and updating global
// platform configuration (grace period, etc.)
// ============================================================

import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('superadmin-platform-config');

router.use(authenticate, requireSuperAdmin);

// GET /api/super-admin/platform-config
// List all platform config values
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const configs = await prisma.platformConfig.findMany({
      orderBy: { key: 'asc' },
    });
    res.json({ data: configs });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/platform-config/:key
// Get a single config value
router.get('/:key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.platformConfig.findUnique({
      where: { key: String(req.params.key) },
    });
    if (!config) {
      return res.status(404).json({ error: { message: 'Config key not found', code: 'NOT_FOUND' } });
    }
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/platform-config/:key
// Update a config value
router.patch('/:key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { value } = req.body;

    if (value === undefined || value === null || String(value).trim() === '') {
      return res.status(400).json({ error: { message: 'value is required', code: 'VALIDATION_ERROR' } });
    }

    const existing = await prisma.platformConfig.findUnique({
      where: { key: String(req.params.key) },
    });

    if (!existing) {
      return res.status(404).json({ error: { message: 'Config key not found', code: 'NOT_FOUND' } });
    }

    // Type validation
    if (existing.valueType === 'number' && isNaN(Number(value))) {
      return res.status(400).json({ error: { message: `Value must be a number for key ${req.params.key}`, code: 'VALIDATION_ERROR' } });
    }

    if (existing.valueType === 'boolean' && !['true', 'false'].includes(String(value))) {
      return res.status(400).json({ error: { message: `Value must be true or false for key ${req.params.key}`, code: 'VALIDATION_ERROR' } });
    }

    const updated = await prisma.platformConfig.update({
      where: { key: String(req.params.key) },
      data: {
        value: String(value),
        updatedBy: req.user!.userId,
      },
    });

    log.info({ key: req.params.key, value, updatedBy: req.user!.userId }, 'Platform config updated');

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
