import { Router, Response, NextFunction } from 'express';
import { authenticate, requireOrgAdminOrAccountant, AuthRequest } from '../middleware/auth';
import { notificationService } from '../services/notification.service';
import { requireFeature } from "../middleware/feature.guard";

const router = Router();

// All routes require authentication. Accountants can access notifications too.
router.use(authenticate);
router.use(requireOrgAdminOrAccountant);
router.use(requireFeature("featureNotifications"));
/**
 * GET /api/notifications/unread
 * Get unread notifications
 */
router.get('/unread', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    const notifications = await notificationService.getUnread(organizationId);
    res.json({ data: notifications });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notifications/count
 * Get unread notification count
 */
router.get('/count', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    const count = await notificationService.getUnreadCount(organizationId);
    res.json({ data: { count } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notifications
 * Get all notifications (paginated)
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    const skip = parseInt(req.query.skip as string) || 0;
    const take = parseInt(req.query.take as string) || 50;
    const result = await notificationService.getAll(organizationId, skip, take);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    await notificationService.markAllAsRead(organizationId);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    await notificationService.markAsRead(String(req.params.id), organizationId);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notifications/clear-read
 * Delete all read notifications
 */
router.delete('/clear-read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    await notificationService.deleteAllRead(organizationId);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    await notificationService.delete(String(req.params.id), organizationId);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notifications/clear-late-arrivals
 * Clear all late arrival notifications
 */
router.post('/clear-late-arrivals', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId!;
    const count = await notificationService.clearLateArrivalNotifications(organizationId);
    res.json({ data: { cleared: count } });
  } catch (error) {
    next(error);
  }
});

export default router;
