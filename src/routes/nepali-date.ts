import { Router, Response, NextFunction } from 'express';
import { nepaliDateService } from '../services/config.service';
import { validate } from '../middleware/validate';
import { convertDateQuerySchema, monthInfoQuerySchema } from '../schemas/config.schema';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/nepali-date/today
router.get('/today', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await nepaliDateService.getToday(req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/nepali-date/convert
router.get('/convert', validate(convertDateQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = nepaliDateService.convert(req.query as any);
    if (!result) {
      return res.status(400).json({ error: { message: 'Provide either ad date or bsYear+bsMonth+bsDay' } });
    }
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/nepali-date/month-info
router.get('/month-info', validate(monthInfoQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear, bsMonth } = req.query as any;
    const data = await nepaliDateService.getMonthInfo(bsYear, bsMonth, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/nepali-date/years
router.get('/years', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await nepaliDateService.getYears(req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
