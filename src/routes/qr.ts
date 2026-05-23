import { Router, Response, NextFunction } from 'express';
import { qrService } from '../services/qr.service';
import { authenticate, requireOrgAdmin, requireOrgAdminStrict, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// POST /api/qr/generate — Generate rotating QR (24h expiry)
// Org-wide action — branch admins must not rotate the QR for the whole org.
router.post(
  '/generate',
  requireOrgAdminStrict,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await qrService.generate(req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/qr/generate-static — Generate static QR (no expiry, printable)
// Org-wide action — strict guard.
router.post(
  '/generate-static',
  requireOrgAdminStrict,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await qrService.generateStatic(req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/qr/regenerate-static — Revoke old static QR and generate new one
// Org-wide action — strict guard.
router.post(
  '/regenerate-static',
  requireOrgAdminStrict,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await qrService.regenerateStatic(req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/qr/active — Get current active QR code for display at the branch.
// BRANCH_ADMIN can read this so they can display the QR at their location.
// FIX C-06: Added requireOrgAdmin guard. Previously any authenticated employee
// could call this endpoint and retrieve the full QR token + signature,
// which is the first step in the ghost attendance attack chain.
router.get(
  '/active',
  requireOrgAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await qrService.getActive(req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/qr/revoke — Revoke all active QR codes
// Org-wide action — strict guard.
router.post(
  '/revoke',
  requireOrgAdminStrict,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await qrService.revoke(req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
