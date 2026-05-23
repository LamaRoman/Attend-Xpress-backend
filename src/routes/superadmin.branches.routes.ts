import { Router, Response, NextFunction } from 'express';
import { branchService } from '../services/branch.service';
import { validate } from '../middleware/validate';
import {
  createBranchSchema,
  updateBranchSchema,
  branchIdParamSchema,
  listBranchesQuerySchema,
} from '../schemas/branch.schema';
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// All routes in this file are SUPER_ADMIN only.
router.use(authenticate, requireSuperAdmin);

// GET /api/super-admin/branches?organizationId=...&includeInactive=true
router.get(
  '/',
  validate(listBranchesQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const branches = await branchService.listAll(req.query as any);
      res.json({ data: branches });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/super-admin/branches/:id
router.get(
  '/:id',
  validate(branchIdParamSchema, 'params'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const branch = await branchService.getById(String(req.params.id), req.user!);
      res.json({ data: branch });
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/super-admin/branches
router.post(
  '/',
  validate(createBranchSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const branch = await branchService.create(req.body);
      res.status(201).json({ data: branch });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /api/super-admin/branches/:id
router.put(
  '/:id',
  validate(branchIdParamSchema, 'params'),
  validate(updateBranchSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const branch = await branchService.update(String(req.params.id), req.body);
      res.json({ data: branch });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/super-admin/branches/:id  (soft delete)
router.delete(
  '/:id',
  validate(branchIdParamSchema, 'params'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await branchService.softDelete(String(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
