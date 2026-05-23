import { Router, Response, NextFunction } from 'express';
import { holidayService } from '../services/holiday.service';
import { validate } from '../middleware/validate';
import { createHolidaySchema, updateHolidaySchema, syncHolidaysSchema, holidayListQuerySchema } from '../schemas/holiday.schema';
import { authenticate, requireOrgAdmin, enforceOrgIsolation, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.use(authenticate, requireOrgAdmin, enforceOrgIsolation);

// GET /api/holidays
router.get('/', validate(holidayListQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holidays = await holidayService.listHolidays(req.user!, req.query as any);
    res.json({ data: holidays });
  } catch (error) {
    next(error);
  }
});

// GET /api/holidays/master - Get available master holidays for import
router.get('/master', validate(holidayListQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear } = req.query as any;
    
    const where: any = {
      organizationId: null, // Master holidays only
      isActive: true,
    };

    if (bsYear) {
      where.bsYear = parseInt(bsYear as string, 10);
    }

    const masterHolidays = await prisma.holiday.findMany({
      where,
      orderBy: [
        { bsYear: 'desc' },
        { bsMonth: 'asc' },
        { bsDay: 'asc' },
      ],
    });

    // Check which holidays are already imported
    const orgId = req.user!.organizationId!;
    const existingHolidays = await prisma.holiday.findMany({
      where: {
        organizationId: orgId,
        ...(bsYear && { bsYear: parseInt(bsYear as string, 10) }),
      },
      select: {
        bsYear: true,
        bsMonth: true,
        bsDay: true,
        name: true,
      },
    });

    const existingSet = new Set(
      existingHolidays.map(h => `${h.bsYear}-${h.bsMonth}-${h.bsDay}-${h.name}`)
    );

    const holidaysWithStatus = masterHolidays.map(h => ({
      ...h,
      alreadyImported: existingSet.has(`${h.bsYear}-${h.bsMonth}-${h.bsDay}-${h.name}`),
    }));

    res.json({ data: holidaysWithStatus });
  } catch (error) {
    next(error);
  }
});

// POST /api/holidays/import - Import master holidays to organization
router.post('/import', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear } = req.body;

    if (!bsYear) {
      return res.status(400).json({
        error: { message: 'BS year is required' },
      });
    }

    const orgId = req.user!.organizationId!;

    // Get master holidays for the year
    const masterHolidays = await prisma.holiday.findMany({
      where: {
        organizationId: null,
        bsYear: parseInt(bsYear as string, 10),
        isActive: true,
      },
    });

    if (masterHolidays.length === 0) {
      return res.status(404).json({
        error: { message: `No master holidays found for BS ${bsYear}` },
      });
    }

    let imported = 0;
    let skipped = 0;

    for (const master of masterHolidays) {
      // Check if already exists
      const existing = await prisma.holiday.findFirst({
        where: {
          organizationId: orgId,
          bsYear: master.bsYear,
          bsMonth: master.bsMonth,
          bsDay: master.bsDay,
          name: master.name,
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Create copy for organization
      await prisma.holiday.create({
        data: {
          name: master.name,
          nameNepali: master.nameNepali,
          bsYear: master.bsYear,
          bsMonth: master.bsMonth,
          bsDay: master.bsDay,
          date: master.date,
          type: master.type,
          isRecurring: master.isRecurring,
          organizationId: orgId,
          isActive: true,
        },
      });

      imported++;
    }

    res.json({
      data: {
        message: `Imported ${imported} holidays for BS ${bsYear}, skipped ${skipped} existing`,
        imported,
        skipped,
        year: bsYear,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/holidays/sync
router.post('/sync', validate(syncHolidaysSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await holidayService.syncHolidaysForBSYear(req.body.bsYear);
    res.json({ data: { message: `Synced ${result.synced} holidays, skipped ${result.skipped} existing`, ...result } });
  } catch (error) {
    next(error);
  }
});

// POST /api/holidays
router.post('/', validate(createHolidaySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holiday = await holidayService.createHoliday(req.body, req.user!);
    res.status(201).json({ data: holiday });
  } catch (error) {
    next(error);
  }
});

// PUT /api/holidays/:id
router.put('/:id', validate(updateHolidaySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holiday = await holidayService.updateHoliday(String(req.params.id), req.body.isActive, req.user!);
    res.json({ data: holiday });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await holidayService.deleteHoliday(String(req.params.id), req.user!);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;