import { Router, Request, Response, NextFunction } from 'express';
import { attendanceService } from '../services/attendance.service';
import { runAutoClose } from '../jobs/midnight-autoclose.job';
import { validate } from '../middleware/validate';
import {
  scanPublicSchema,
  scanAuthenticatedSchema,
  mobileCheckinSchema,
  manualAttendanceSchema,
  editAttendanceSchema,
  attendanceListQuerySchema,
  myAttendanceQuerySchema,
  userAttendanceRangeQuerySchema,
} from '../schemas/attendance.schema';
import {
  authenticate,
  requireOrgAdmin,
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  AuthRequest,
} from '../middleware/auth';
import { scanRateLimiter } from '../middleware/rateLimiter';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/attendance/qr-org-info/:token -- Public
// Returns org geofence status for a given QR token so the scan page
// can skip asking for location when geofencing is disabled.
router.get(
  '/qr-org-info/:token',
  scanRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qrCode = await prisma.qRCode.findUnique({
        where: { token: String(req.params.token) },
        select: { organization: { select: { geofenceEnabled: true } } },
      });
      if (!qrCode) {
        res.status(404).json({ error: { message: 'QR code not found' } });
        return;
      }
      res.json({ data: { geofenceEnabled: qrCode.organization.geofenceEnabled } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/scan-public -- Unauthenticated, uses employee ID + PIN
router.post(
  '/scan-public',
  scanRateLimiter,
  validate(scanPublicSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.scanPublic(
        req.body,
        req.ip || undefined,
        req.get('user-agent') || undefined
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/org-mode/:orgId -- Public
router.get(
  '/org-mode/:orgId',
  scanRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: String(req.params.orgId) },
        select: { attendanceMode: true, geofenceEnabled: true },
      });
      if (!org) {
        res.status(404).json({ error: { message: 'Organization not found' } });
        return;
      }
      res.json({
        data: {
          attendanceMode: org.attendanceMode,
          geofenceEnabled: org.geofenceEnabled,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/org-slug/:slug -- Public
router.get(
  '/org-slug/:slug',
  scanRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await prisma.organization.findUnique({
        where: { slug: String(req.params.slug).toLowerCase() },
        select: { id: true, attendanceMode: true, geofenceEnabled: true },
      });
      if (!org) {
        res.status(404).json({ error: { message: 'Organization not found' } });
        return;
      }
      res.json({ data: org });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/mobile-checkin -- Unauthenticated, GPS-based, requires PIN (kiosk use)
router.post(
  '/mobile-checkin',
  scanRateLimiter,
  validate(mobileCheckinSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.mobileCheckin(
        req.body,
        req.ip || undefined,
        req.get('user-agent') || undefined
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/mobile-checkin-auth -- Authenticated GPS check-in for mobile app
// Employee is already identified via Bearer token — no PIN or employeeId needed
router.post(
  '/mobile-checkin-auth',
  scanRateLimiter,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.membershipId) {
        return res.status(400).json({ error: { message: 'No active membership' } });
      }

      const { latitude, longitude } = req.body;

      // Coordinates are optional — service will enforce when geofence is enabled
      const lat = typeof latitude === 'number' ? latitude : undefined;
      const lng = typeof longitude === 'number' ? longitude : undefined;

      const result = await attendanceService.mobileCheckinAuth(
        { latitude: lat, longitude: lng },
        req.user!,
        req.ip || undefined,
        req.get('user-agent') || undefined
      );

      return res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/scan -- Authenticated QR scan
router.post(
  '/scan',
  authenticate,
  validate(scanAuthenticatedSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.scanAuthenticated(
        req.body,
        req.user!,
        req.ip || undefined,
        req.get('user-agent') || undefined
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/status -- Current clock-in status for the active membership
router.get(
  '/status',
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.membershipId) {
        return res.status(400).json({ error: { message: 'No active membership' } });
      }
      const status = await attendanceService.getStatus(req.user!.membershipId);
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/my -- My attendance records (scoped to active membership)
router.get(
  '/my',
  authenticate,
  validate(myAttendanceQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user!.membershipId) {
        return res.status(400).json({ error: { message: 'No active membership' } });
      }
      const { limit, offset, bsYear, bsMonth } = req.query as any;
      const result = await attendanceService.getMyAttendance(
        req.user!.membershipId,
        limit,
        offset,
        { bsYear, bsMonth }
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/user/:userId?startDate=&endDate= -- Admin: individual employee history
router.get(
  '/user/:userId',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  validate(userAttendanceRangeQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.params.userId);
      const { startDate, endDate } = req.query as { startDate: string; endDate: string };
      const orgId = req.user!.organizationId!;

      // Verify the target user belongs to this org
      const membership = await prisma.orgMembership.findFirst({
        where: { userId, organizationId: orgId, isActive: true, leftAt: null },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!membership) {
        return res.status(404).json({ error: { message: 'Employee not found in this organization' } });
      }

      // Load org shift config for On Time / Late calculation
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { workStartTime: true, lateThresholdMinutes: true, workingDays: true },
      });
      if (!org) {
        return res.status(404).json({ error: { message: 'Organization not found' } });
      }

      const start = new Date(startDate + 'T00:00:00');
      const end   = new Date(endDate   + 'T23:59:59.999');

      const records = await prisma.attendanceRecord.findMany({
        where: {
          membershipId: membership.id,
          checkInTime: { gte: start, lte: end },
        },
        orderBy: { checkInTime: 'asc' },
      });

      // Compute On Time / Late per record
      const [workHour, workMinute] = org.workStartTime.split(':').map(Number);
      const threshold = org.lateThresholdMinutes ?? 10;

      const enriched = records.map((r) => {
        const checkIn = new Date(r.checkInTime);
        const workStart = new Date(checkIn);
        workStart.setHours(workHour, workMinute, 0, 0);
        const minutesLate = Math.floor((checkIn.getTime() - workStart.getTime()) / 60000);
        const arrivalStatus: 'ON_TIME' | 'LATE' =
          minutesLate > threshold ? 'LATE' : 'ON_TIME';

        return {
          id: r.id,
          checkInTime:       r.checkInTime,
          checkOutTime:      r.checkOutTime,
          duration:          r.duration,
          status:            r.status,
          isManualEntry:     r.isManualEntry,
          modificationNote:  r.modificationNote,
          arrivalStatus,
          minutesLate:       minutesLate > 0 ? minutesLate : 0,
        };
      });

      res.json({
        data: {
          employee: {
            id:         membership.user.id,
            firstName:  membership.user.firstName,
            lastName:   membership.user.lastName,
            email:      membership.user.email,
            employeeId: membership.employeeId,
          },
          orgConfig: {
            workStartTime:       org.workStartTime,
            lateThresholdMinutes: threshold,
            workingDays:         org.workingDays,
          },
          records: enriched,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance -- Admin/Accountant list (org-scoped)
router.get(
  '/',
  authenticate,
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  validate(attendanceListQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, userId, status, date } = req.query as any;
      const result = await attendanceService.listAttendance(req.user!, limit, offset, {
        userId,
        status,
        date,
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/manual -- Admin manual clock in/out (ORG_ADMIN only)
router.post(
  '/manual',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  validate(manualAttendanceSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.manualAttendance(req.body, req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/attendance/:id/edit
router.put(
  '/:id/edit',
  authenticate,
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  validate(editAttendanceSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.editAttendance(
        String(req.params.id),
        req.body,
        req.user!
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/attendance/:id/acknowledge
router.put(
  '/:id/acknowledge',
  authenticate,
  requireOrgAdminOrAccountant,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.acknowledgeAttendance(
        String(req.params.id),
        req.user!
      );
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/mark-present -- Admin marks absent employee as present (ORG_ADMIN only)
router.post(
  '/mark-present',
  authenticate,
  requireOrgAdmin,
  enforceOrgIsolation,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await attendanceService.markPresent(req.body, req.user!);
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/attendance/late-arrivals -- Late arrivals with filters and statistics
router.get(
  '/late-arrivals',
  authenticate,
  requireOrgAdminOrAccountant,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.organizationId) {
        return res
          .status(400)
          .json({ error: { message: 'No organization associated' } });
      }

      const { range = 'today', fromDate, toDate } = req.query;

      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { workStartTime: true, lateThresholdMinutes: true },
      });

      if (!org || !org.workStartTime) {
        return res.json({ data: { records: [], stats: null } });
      }

      let startDate: Date;
      let endDate: Date;
      const now = new Date();

      switch (range) {
        case 'today':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(now);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'month':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 30);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(now);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'custom':
          if (fromDate && toDate) {
            startDate = new Date(fromDate as string);
            endDate = new Date(toDate as string);
            endDate.setHours(23, 59, 59, 999);
          } else {
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 1);
          }
          break;
        default:
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
      }

      const records = await prisma.attendanceRecord.findMany({
        where: {
          organizationId: req.user.organizationId,
          status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
          checkInTime: { gte: startDate, lte: endDate },
        },
        include: {
          membership: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { checkInTime: 'desc' },
      });

      const [workHour, workMinute] = org.workStartTime.split(':').map(Number);
      const threshold = org.lateThresholdMinutes || 10;

      const lateArrivals = records
        .map((record) => {
          const checkIn = new Date(record.checkInTime!);
          const workStart = new Date(checkIn);
          workStart.setHours(workHour, workMinute, 0, 0);
          const minutesLate = Math.floor(
            (checkIn.getTime() - workStart.getTime()) / 60000
          );
          if (minutesLate > threshold) {
            return {
              id: record.id,
              userId: record.membership.userId,
              userName: `${record.membership.user.firstName} ${record.membership.user.lastName}`,
              employeeId: record.membership.employeeId,
              date: record.checkInTime,
              checkInTime: record.checkInTime,
              minutesLate,
            };
          }
          return null;
        })
        .filter(Boolean);

      const stats = {
        totalLateArrivals: lateArrivals.length,
        averageMinutesLate:
          lateArrivals.length > 0
            ? Math.round(
                lateArrivals.reduce((sum: number, r: any) => sum + r.minutesLate, 0) /
                  lateArrivals.length
              )
            : 0,
        repeatOffenders: Object.entries(
          lateArrivals.reduce((acc: any, r: any) => {
            acc[r.userId] = acc[r.userId] || {
              userName: r.userName,
              employeeId: r.employeeId,
              count: 0,
              totalMinutesLate: 0,
            };
            acc[r.userId].count++;
            acc[r.userId].totalMinutesLate += r.minutesLate;
            return acc;
          }, {})
        )
          .map(([userId, data]: any) => ({
            userId,
            userName: data.userName,
            employeeId: data.employeeId,
            lateCount: data.count,
            averageMinutesLate: Math.round(data.totalMinutesLate / data.count),
          }))
          .sort((a: any, b: any) => b.lateCount - a.lateCount)
          .slice(0, 5),
      };

      res.json({ data: { records: lateArrivals, stats } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/attendance/auto-close — Admin trigger for stale record cleanup
router.post('/auto-close', authenticate, requireOrgAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await runAutoClose('api');
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;