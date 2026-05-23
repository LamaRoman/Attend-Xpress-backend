import { Router, Response, NextFunction } from 'express';
import { holidayService } from '../services/holiday.service';
import { validate } from '../middleware/validate';
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { notificationService } from '../services/notification.service';

const router = Router();

// All routes require super admin
router.use(authenticate, requireSuperAdmin);

// Validation schemas
const syncHolidaysSchema = z.object({
  bsYear: z.number().int().min(2070).max(2100),
});

const createMasterHolidaySchema = z.object({
  name: z.string().min(1),
  nameNepali: z.string().optional(),
  bsYear: z.number().int().min(2070).max(2100),
  bsMonth: z.number().int().min(1).max(12),
  bsDay: z.number().int().min(1).max(32),
  date: z.string().datetime(),
  type: z.enum(['PUBLIC_HOLIDAY', 'RESTRICTED_HOLIDAY']),
  description: z.string().optional(),
});

const updateMasterHolidaySchema = z.object({
  isActive: z.boolean(),
});

// GET /api/super-admin/master-holidays - List master holidays
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bsYear = req.query.bsYear ? parseInt(req.query.bsYear as string) : undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
    const type = req.query.type as 'PUBLIC_HOLIDAY' | 'RESTRICTED_HOLIDAY' | undefined;
    const search = req.query.search as string | undefined;

    const where: any = {
      organizationId: null, // Master holidays only
    };

    if (bsYear) where.bsYear = bsYear;
    if (isActive !== undefined) where.isActive = isActive;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameNepali: { contains: search } },
      ];
    }

    const holidays = await prisma.holiday.findMany({
      where,
      orderBy: [
        { bsYear: 'desc' },
        { bsMonth: 'asc' },
        { bsDay: 'asc' },
      ],
    });

    // Get import stats for each year
    const years = [...new Set(holidays.map(h => h.bsYear))];
    const importStats = await Promise.all(
      years.map(async (year) => {
        const totalOrgs = await prisma.organization.count({
          where: { isActive: true },
        });

        const orgsWithHolidays = await prisma.holiday.groupBy({
          by: ['organizationId'],
          where: {
            bsYear: year,
            organizationId: { not: null },
          },
          _count: true,
        });

        return {
          bsYear: year,
          totalOrgs,
          importedOrgs: orgsWithHolidays.length,
        };
      })
    );

    res.json({
      data: {
        holidays,
        importStats,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/master-holidays/sync - Sync holidays from Calendarific API or built-in data
router.post('/sync', validate(syncHolidaysSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear } = req.body;

    // Use existing holiday service method - it tries Calendarific first, falls back to built-in
    const result = await holidayService.syncHolidaysForBSYear(bsYear);

    // Auto-clear the master holidays notification after successful sync
    await notificationService.clearMasterHolidaysNotification(
      req.user!.organizationId!,
      bsYear
    );

    res.json({
      data: {
        message: `Synced ${result.synced} holidays for BS ${bsYear} from ${result.source}`,
        synced: result.synced,
        skipped: result.skipped,
        source: result.source, // 'api' or 'built-in'
        bsYear,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/master-holidays - Create custom master holiday
router.post('/', validate(createMasterHolidaySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, nameNepali, bsYear, bsMonth, bsDay, date, type, description } = req.body;

    // Validate BS date
    if (bsMonth < 1 || bsMonth > 12) {
      return res.status(400).json({ error: { message: 'BS month must be between 1 and 12' } });
    }
    if (bsDay < 1 || bsDay > 32) {
      return res.status(400).json({ error: { message: 'BS day must be between 1 and 32' } });
    }

    // Check for duplicate (same BS date)
    const existing = await prisma.holiday.findFirst({
      where: {
        organizationId: null,
        bsYear,
        bsMonth,
        bsDay,
      },
    });

    if (existing) {
      return res.status(409).json({
        error: { message: `A master holiday already exists for ${bsYear}/${bsMonth}/${bsDay} (${existing.name})` },
      });
    }

    // Create master holiday
    const holiday = await prisma.holiday.create({
      data: {
        name,
        nameNepali: nameNepali || null,
        bsYear,
        bsMonth,
        bsDay,
        date: new Date(date),
        type,
        description: description || null,
        organizationId: null, // Master holiday
        isActive: true,
        isRecurring: false,
      },
      
    });
    // Notify all org admins
    await notificationService.notifyMasterHolidaysUpdated(holiday.bsYear);

    res.status(201).json({
      data: {
        message: 'Master holiday created successfully',
        holiday,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/master-holidays/:id - Update master holiday (toggle active status)
router.patch('/:id', validate(updateMasterHolidaySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { isActive } = req.body;

    // Verify it's a master holiday
    const holiday = await prisma.holiday.findUnique({
      where: { id },
    });

    if (!holiday) {
      return res.status(404).json({ error: { message: 'Holiday not found' } });
    }

    if (holiday.organizationId !== null) {
      return res.status(403).json({ error: { message: 'Can only update master holidays' } });
    }

    // Update holiday
    const updated = await prisma.holiday.update({
      where: { id },
      data: { isActive },
    });

    res.json({
      data: {
        message: `Holiday ${isActive ? 'activated' : 'deactivated'}`,
        holiday: updated,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/super-admin/master-holidays/:id - Delete master holiday
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);

    // Verify it's a master holiday
    const holiday = await prisma.holiday.findUnique({
      where: { id },
    });

    if (!holiday) {
      return res.status(404).json({ error: { message: 'Holiday not found' } });
    }

    if (holiday.organizationId !== null) {
      return res.status(403).json({ error: { message: 'Can only delete master holidays' } });
    }

    // Check how many orgs have imported this holiday (optional warning)
    const importCount = await prisma.holiday.count({
      where: {
        bsYear: holiday.bsYear,
        bsMonth: holiday.bsMonth,
        bsDay: holiday.bsDay,
        organizationId: { not: null },
      },
    });

    // Delete master holiday
    await prisma.holiday.delete({
      where: { id },
    });

    res.json({
      data: {
        message: 'Master holiday deleted',
        importedByOrgs: importCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/master-holidays/stats/:bsYear - Get import statistics for a year
router.get('/stats/:bsYear', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bsYear = parseInt(String(req.params.bsYear), 10);

    if (isNaN(bsYear) || bsYear < 2070 || bsYear > 2100) {
      return res.status(400).json({ error: { message: 'Invalid BS year' } });
    }

    const totalOrgs = await prisma.organization.count({
      where: { isActive: true },
    });

    const orgsWithHolidays = await prisma.holiday.groupBy({
      by: ['organizationId'],
      where: {
        bsYear,
        organizationId: { not: null },
      },
      _count: true,
    });

    const masterHolidayCount = await prisma.holiday.count({
      where: {
        bsYear,
        organizationId: null,
      },
    });

    res.json({
      data: {
        bsYear,
        totalOrgs,
        importedOrgs: orgsWithHolidays.length,
        percentage: totalOrgs > 0 ? Math.round((orgsWithHolidays.length / totalOrgs) * 100) : 0,
        masterHolidayCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
