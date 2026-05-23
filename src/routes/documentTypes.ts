import { Router, Response } from 'express';
import { authenticate, requireOrgAdmin, AuthRequest } from '../middleware/auth';
import {
  listDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  getComplianceSummary,
} from '../services/documentTypes.service';

const router = Router();

// ── GET /api/org/document-types — List document types (any authenticated user in org) ──
router.get('/org/document-types', authenticate, async (req: AuthRequest, res: Response) => {
  console.log("DOCTYPES_HIT", req.user?.role);
  try {
    const includeInactive = req.user!.role === 'ORG_ADMIN' && req.query.all === 'true';
    const types = await listDocumentTypes(req.user!.organizationId!, includeInactive);
    return res.json(types);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to list document types' });
  }
});

// ── POST /api/org/document-types — Create (admin only) ──
router.post('/org/document-types', authenticate, requireOrgAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, nameNp, description, isRequired } = req.body;
    const docType = await createDocumentType({
      organizationId: req.user!.organizationId!,
      name,
      nameNp,
      description,
      isRequired,
    });
    return res.status(201).json(docType);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to create document type' });
  }
});

// ── PATCH /api/org/document-types/:id — Update (admin only) ──
router.patch('/org/document-types/:id', authenticate, requireOrgAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, nameNp, description, isRequired, isActive } = req.body;
    const docType = await updateDocumentType({
      id: String(req.params.id),
      organizationId: req.user!.organizationId!,
      name,
      nameNp,
      description,
      isRequired,
      isActive,
    });
    return res.json(docType);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to update document type' });
  }
});

// ── DELETE /api/org/document-types/:id — Delete (admin only, only if unused) ──
router.delete('/org/document-types/:id', authenticate, requireOrgAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await deleteDocumentType(String(req.params.id), req.user!.organizationId!);
    return res.json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to delete document type' });
  }
});

// ── GET /api/org/document-compliance — Compliance summary (admin only) ──
router.get('/org/document-compliance', authenticate, requireOrgAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const summary = await getComplianceSummary(req.user!.organizationId!);
    return res.json(summary);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || 'Failed to get compliance summary' });
  }
});

export default router;