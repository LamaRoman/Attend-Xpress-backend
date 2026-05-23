import { Router, Response, NextFunction } from 'express';
import { superAdminService } from '../services/superAdmin.service';
import { validate } from '../middleware/validate';
import { createOrganizationSchema, updateOrganizationSchema, orgIdParamSchema } from '../schemas/organization.schema';
import { authenticate, requireSuperAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// All routes require super admin
router.use(authenticate, requireSuperAdmin);

// GET /api/super-admin/stats
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await superAdminService.getPlatformStats();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/organizations
router.get('/organizations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizations = await superAdminService.getAllOrganizations();
    res.json({ data: { organizations } });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/organizations/:id
router.get('/organizations/:id', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await superAdminService.getOrganization(String(req.params.id));
    res.json({ data: { organization } });
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/organizations
router.post('/organizations', validate(createOrganizationSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminService.createOrganization(req.body);
    res.status(201).json({ message: 'Organization created successfully', ...result });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/organizations/:id
router.patch('/organizations/:id', validate(orgIdParamSchema, 'params'), validate(updateOrganizationSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await superAdminService.updateOrganization(String(req.params.id), req.body);
    res.json({ data: { message: 'Organization updated successfully', organization } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/super-admin/organizations/:id
router.delete('/organizations/:id', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await superAdminService.deleteOrganization(String(req.params.id));
    res.json({ data: { message: 'Organization deactivated successfully', organization } });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/organizations/:id/toggle-status
router.patch('/organizations/:id/toggle-status', validate(orgIdParamSchema, 'params'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organization = await superAdminService.toggleStatus(String(req.params.id));
    res.json({ data: { message: `Organization ${organization.isActive ? 'activated' : 'deactivated'}`, organization } });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/tds-slabs -- Get current TDS slabs
router.get('/tds-slabs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slabs = await superAdminService.getTDSSlabs();
    res.json({ data: slabs });
  } catch (error) { next(error); }
});

// PUT /api/super-admin/tds-slabs -- Update TDS slabs
router.put('/tds-slabs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await superAdminService.updateTDSSlabs(req.body);
    res.json({ data: result });
  } catch (error) { next(error); }
});

export default router;
