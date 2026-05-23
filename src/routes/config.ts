import { Router, Response, NextFunction } from 'express';
import { configService } from '../services/config.service';
import { validate } from '../middleware/validate';
import { updateConfigSchema } from '../schemas/config.schema';
import { authenticate, requireOrgAdmin, enforceOrgIsolation, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireOrgAdmin, enforceOrgIsolation);

// GET /api/config
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await configService.getConfigs(req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/config/:key
router.put('/:key', validate(updateConfigSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await configService.setConfig(String(req.params.key), req.body.value, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
