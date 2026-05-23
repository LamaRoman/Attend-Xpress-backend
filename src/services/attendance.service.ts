import prisma from '../lib/prisma';
import { parseQRPayload } from '../lib/crypto';
import { verifyPassword } from '../lib/password';
import { adToBS } from '../lib/nepali-date';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import { createLogger } from '../logger';
import { JWTPayload } from '../lib/jwt';
import {
  ScanPublicInput,
  ScanAuthenticatedInput,
  ManualAttendanceInput,
  MobileCheckinInput,
} from '../schemas/attendance.schema';
import { notificationService } from './notification.service';
import { payrollService } from './payroll.service';
import {
  validateGeofence,
  resolveGeofenceConfig,
  BranchGeofenceOverride,
} from '../lib/geofence';
import {
  checkScanLockout,
  recordFailedScanAttempt,
  clearFailedScanAttempts,
} from '../lib/scan-lockout';

const log = createLogger('attendance-service');

import {
  SCAN_COOLDOWN_MINUTES,
  AUTO_CLOSE_GRACE_MINUTES,
  formatTimeNPT,
  getTodayRangeNPT,
  validateTimestamp,
} from './attendance.helpers';

export class AttendanceService {
  // ======== QR / mobile scans ========

  async scanPublic(input: ScanPublicInput, ipAddress?: string, userAgent?: string) {
    await checkScanLockout(input.employeeId);

    const qrOrgId = await this.validateQRPayloadAndGetOrg(input.qrPayload);

    const membership = await prisma.orgMembership.findFirst({
      where: {
        employeeId: input.employeeId,
        organizationId: qrOrgId,
        isActive: true,
        deletedAt: null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!membership) {
      await this.logAudit({
        employeeId: input.employeeId,
        organizationId: qrOrgId,
        action: 'FAILED',
        method: 'QR_SCAN',
        success: false,
        failureReason: 'EMPLOYEE_NOT_FOUND',
        ipAddress,
        userAgent,
        latitude: input.latitude,
        longitude: input.longitude,
      });
      throw new ValidationError('Invalid employee ID or QR code', 'INVALID_SCAN');
    }

    if (!membership.attendancePinHash) {
      throw new ValidationError(
        'Attendance PIN not set. Please contact your administrator.',
        'PIN_NOT_SET'
      );
    }

    const isPinValid = await verifyPassword(input.pin, membership.attendancePinHash);
    if (!isPinValid) {
      await recordFailedScanAttempt(input.employeeId);
      await this.logAudit({
        employeeId: input.employeeId,
        userId: membership.user.id,
        organizationId: membership.organizationId,
        action: 'FAILED',
        method: 'QR_SCAN',
        success: false,
        failureReason: 'INVALID_PIN',
        ipAddress,
        userAgent,
        latitude: input.latitude,
        longitude: input.longitude,
      });
      throw new ValidationError('Invalid employee ID or QR code', 'INVALID_SCAN');
    }

    await clearFailedScanAttempts(input.employeeId);

    await this.incrementQRScanCount(input.qrPayload);

    const org = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
      select: {
        geofenceEnabled: true,
        officeLat: true,
        officeLng: true,
        geofenceRadius: true,
      },
    });

    if (org) {
      try {
        const branchGeo = await this.getMembershipBranchGeo(membership.id);
        const geofenceConfig = resolveGeofenceConfig(org, branchGeo);
        validateGeofence(geofenceConfig, {
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy: input.accuracy,
        });
      } catch (err) {
        await this.logAudit({
          employeeId: input.employeeId,
          userId: membership.user.id,
          organizationId: membership.organizationId,
          action: 'FAILED',
          method: 'QR_SCAN',
          success: false,
          failureReason: 'OUTSIDE_GEOFENCE',
          ipAddress,
          userAgent,
          latitude: input.latitude,
          longitude: input.longitude,
        });
        throw err;
      }
    }

    const result = await this.performClockActionSafe(
      membership.id,
      membership.organizationId,
      'QR_SCAN'
    );

    if (result.action === 'CLOCK_IN') {
      this.checkAndNotifyLateArrival(
        membership.id,
        membership.organizationId,
        result.record.checkInTime,
        result.record.id
      ).catch((err) => log.error({ err }, 'Late arrival check failed'));
    }

    await this.logAudit({
      employeeId: input.employeeId,
      userId: membership.user.id,
      organizationId: membership.organizationId,
      action: result.action,
      method: 'QR_SCAN',
      success: true,
      ipAddress,
      userAgent,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    const userName = `${membership.user.firstName} ${membership.user.lastName}`;
    const message =
      result.action === 'CLOCK_IN'
        ? `${userName} clocked in at ${formatTimeNPT(result.record.checkInTime)}`
        : `${userName} clocked out. Duration: ${result.record.duration} minutes`;

    return {
      ...result,
      message,
      user: {
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        employeeId: membership.employeeId,
      },
    };
  }

  async mobileCheckin(input: MobileCheckinInput, ipAddress?: string, userAgent?: string) {
    await checkScanLockout(input.employeeId);

    if (!input.organizationId) {
      throw new ValidationError(
        'Organization context is required for mobile check-in.',
        'ORG_REQUIRED'
      );
    }

    const membership = await prisma.orgMembership.findFirst({
      where: {
        employeeId: input.employeeId,
        organizationId: input.organizationId,
        isActive: true,
        deletedAt: null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!membership) {
      await this.logAudit({
        employeeId: input.employeeId,
        organizationId: input.organizationId,
        action: 'FAILED',
        method: 'MOBILE_CHECKIN',
        success: false,
        failureReason: 'EMPLOYEE_NOT_FOUND',
        ipAddress,
        userAgent,
        latitude: input.latitude,
        longitude: input.longitude,
      });
      throw new ValidationError('Invalid employee ID', 'INVALID_SCAN');
    }

    if (!membership.attendancePinHash) {
      throw new ValidationError(
        'Attendance PIN not set. Please contact your administrator.',
        'PIN_NOT_SET'
      );
    }

    const isPinValid = await verifyPassword(input.pin, membership.attendancePinHash);
    if (!isPinValid) {
      await recordFailedScanAttempt(input.employeeId);
      await this.logAudit({
        employeeId: input.employeeId,
        userId: membership.user.id,
        organizationId: membership.organizationId,
        action: 'FAILED',
        method: 'MOBILE_CHECKIN',
        success: false,
        failureReason: 'INVALID_PIN',
        ipAddress,
        userAgent,
        latitude: input.latitude,
        longitude: input.longitude,
      });
      throw new ValidationError('Invalid employee ID or PIN', 'INVALID_SCAN');
    }

    await clearFailedScanAttempts(input.employeeId);

    const org = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
    });
    if (!org) throw new NotFoundError('Organization not found');

    if (org.attendanceMode === 'QR_ONLY') {
      throw new ValidationError(
        'Mobile check-in is not enabled for this organization. Please use QR scan.',
        'MOBILE_CHECKIN_DISABLED'
      );
    }

    // Resolve geofence config — branch-level location takes precedence over
    // org-level. The "configured" gate below checks the *effective* config.
    const branchGeo = await this.getMembershipBranchGeo(membership.id);
    const geofenceConfig = resolveGeofenceConfig(org, branchGeo);

    if (
      !geofenceConfig.geofenceEnabled ||
      geofenceConfig.officeLat == null ||
      geofenceConfig.officeLng == null
    ) {
      throw new ValidationError(
        'Geofencing must be enabled and configured for mobile check-in. Contact your administrator.',
        'GEOFENCE_NOT_CONFIGURED'
      );
    }

    try {
      validateGeofence(geofenceConfig, {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
      });
    } catch (err) {
      await this.logAudit({
        employeeId: input.employeeId,
        userId: membership.user.id,
        organizationId: membership.organizationId,
        action: 'FAILED',
        method: 'MOBILE_CHECKIN',
        success: false,
        failureReason: 'OUTSIDE_GEOFENCE',
        ipAddress,
        userAgent,
        latitude: input.latitude,
        longitude: input.longitude,
      });
      throw err;
    }

    const result = await this.performClockActionSafe(
      membership.id,
      membership.organizationId,
      'MOBILE_CHECKIN'
    );

    if (result.action === 'CLOCK_IN') {
      this.checkAndNotifyLateArrival(
        membership.id,
        membership.organizationId,
        result.record.checkInTime,
        result.record.id
      ).catch((err) => log.error({ err }, 'Late arrival check failed'));
    }

    await this.logAudit({
      employeeId: input.employeeId,
      userId: membership.user.id,
      organizationId: membership.organizationId,
      action: result.action,
      method: 'MOBILE_CHECKIN',
      success: true,
      ipAddress,
      userAgent,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    const userName = `${membership.user.firstName} ${membership.user.lastName}`;
    const message =
      result.action === 'CLOCK_IN'
        ? `${userName} clocked in at ${formatTimeNPT(result.record.checkInTime)}`
        : `${userName} clocked out. Duration: ${result.record.duration} minutes`;

    return {
      ...result,
      message,
      user: {
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        employeeId: membership.employeeId,
      },
    };
  }

  async scanAuthenticated(
    input: ScanAuthenticatedInput,
    currentUser: JWTPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    if (!currentUser.membershipId || !currentUser.organizationId) {
      throw new NotFoundError('Active membership not found');
    }

    await this.validateQRPayload(input.qrPayload, currentUser.organizationId);

    const org = await prisma.organization.findUnique({
      where: { id: currentUser.organizationId },
      select: {
        geofenceEnabled: true,
        officeLat: true,
        officeLng: true,
        geofenceRadius: true,
      },
    });

    if (org) {
      try {
        const branchGeo = await this.getMembershipBranchGeo(currentUser.membershipId);
        const geofenceConfig = resolveGeofenceConfig(org, branchGeo);
        validateGeofence(geofenceConfig, {
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy: input.accuracy,
        });
      } catch (err) {
        await this.logAudit({
          userId: currentUser.userId,
          organizationId: currentUser.organizationId,
          action: 'FAILED',
          method: 'QR_SCAN',
          success: false,
          failureReason: 'OUTSIDE_GEOFENCE',
          ipAddress,
          userAgent,
          latitude: input.latitude,
          longitude: input.longitude,
        });
        throw err;
      }
    }

    const result = await this.performClockActionSafe(
      currentUser.membershipId,
      currentUser.organizationId,
      'QR_SCAN'
    );

    if (result.action === 'CLOCK_IN') {
      this.checkAndNotifyLateArrival(
        currentUser.membershipId,
        currentUser.organizationId,
        result.record.checkInTime,
        result.record.id
      ).catch((err) => log.error({ err }, 'Late arrival check failed'));
    }

    await this.logAudit({
      userId: currentUser.userId,
      organizationId: currentUser.organizationId,
      action: result.action,
      method: 'QR_SCAN',
      success: true,
      ipAddress,
      userAgent,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    const message =
      result.action === 'CLOCK_IN'
        ? `Clocked in at ${formatTimeNPT(result.record.checkInTime)}`
        : `Clocked out. Duration: ${result.record.duration} minutes`;

    return { ...result, message };
  }

  /**
   * Authenticated GPS check-in from mobile app.
   * Employee is identified via Bearer token — no PIN needed.
   * Shares all validation (office hours, cooldown, auto-close) via performClockActionSafe.
   */
  async mobileCheckinAuth(
    input: { latitude?: number; longitude?: number },
    currentUser: JWTPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    if (!currentUser.membershipId || !currentUser.organizationId) {
      throw new NotFoundError('Active membership not found');
    }

    // Geofence check — validateGeofence passes immediately when geofenceEnabled=false
    const org = await prisma.organization.findUnique({
      where: { id: currentUser.organizationId },
      select: {
        geofenceEnabled: true,
        officeLat: true,
        officeLng: true,
        geofenceRadius: true,
      },
    });

    if (org) {
      try {
        const branchGeo = await this.getMembershipBranchGeo(currentUser.membershipId);
        const geofenceConfig = resolveGeofenceConfig(org, branchGeo);
        validateGeofence(geofenceConfig, {
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        });
      } catch (err) {
        await this.logAudit({
          userId: currentUser.userId,
          organizationId: currentUser.organizationId,
          action: 'FAILED',
          method: 'MOBILE_CHECKIN',
          success: false,
          failureReason: 'OUTSIDE_GEOFENCE',
          ipAddress,
          userAgent,
          latitude: input.latitude,
          longitude: input.longitude,
        });
        throw err;
      }
    }

    const result = await this.performClockActionSafe(
      currentUser.membershipId,
      currentUser.organizationId,
      'MOBILE_CHECKIN'
    );

    if (result.action === 'CLOCK_IN') {
      this.checkAndNotifyLateArrival(
        currentUser.membershipId,
        currentUser.organizationId,
        result.record.checkInTime,
        result.record.id
      ).catch((err) => log.error({ err }, 'Late arrival check failed'));
    }

    await this.logAudit({
      userId: currentUser.userId,
      organizationId: currentUser.organizationId,
      action: result.action,
      method: 'MOBILE_CHECKIN',
      success: true,
      ipAddress,
      userAgent,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    const message =
      result.action === 'CLOCK_IN'
        ? `Clocked in at ${formatTimeNPT(result.record.checkInTime)}`
        : `Clocked out. Duration: ${result.record.duration} minutes`;

    return { ...result, message };
  }

  // ======== Admin manual operations ========

  async manualAttendance(input: ManualAttendanceInput, currentUser: JWTPayload) {
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId: input.userId,
        ...(currentUser.role !== 'SUPER_ADMIN'
          ? { organizationId: currentUser.organizationId! }
          : {}),
        isActive: true,
        deletedAt: null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!membership)
      throw new NotFoundError('Employee not found or not active in this organization');

    const openRecord = await prisma.attendanceRecord.findFirst({
      where: { membershipId: membership.id, status: 'CHECKED_IN' },
    });

    const adminNote =
      `Manual ${input.action.toLowerCase().replace('_', ' ')} by admin. ${input.notes || ''}`.trim();
    let record: any;

    if (input.action === 'CLOCK_IN') {
      if (openRecord)
        throw new ValidationError('User is already clocked in', 'ALREADY_CLOCKED_IN');

      const now = new Date();
      const bs = adToBS(now);

      record = await prisma.attendanceRecord.create({
        data: {
          membershipId: membership.id,
          organizationId: membership.organizationId,
          checkInMethod: 'MANUAL',
          status: 'CHECKED_IN',
          notes: adminNote,
          bsYear: bs.year,
          bsMonth: bs.month,
          bsDay: bs.day,
        },
      });

      this.checkAndNotifyLateArrival(
        membership.id,
        membership.organizationId,
        now,
        record.id
      ).catch((err) => log.error({ err }, 'Late arrival check failed'));
    } else {
      if (!openRecord)
        throw new ValidationError('User is not clocked in', 'NOT_CLOCKED_IN');

      const checkOutTime = new Date();
      const durationMinutes = Math.floor(
        (checkOutTime.getTime() - openRecord.checkInTime.getTime()) / 60000
      );

      record = await prisma.attendanceRecord.update({
        where: { id: openRecord.id },
        data: {
          checkOutTime,
          checkOutMethod: 'MANUAL',
          duration: durationMinutes,
          status: 'CHECKED_OUT',
          notes: openRecord.notes ? `${openRecord.notes} | ${adminNote}` : adminNote,
        },
      });
    }

    await this.logAudit({
      userId: membership.user.id,
      organizationId: membership.organizationId,
      action: input.action,
      method: 'MANUAL',
      success: true,
    });

    log.info(
      { membershipId: membership.id, action: input.action, adminId: currentUser.userId },
      'Manual attendance'
    );

    return {
      action: input.action,
      record: {
        ...record,
        user: {
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          employeeId: membership.employeeId,
        },
      },
      message: `${membership.user.firstName} ${membership.user.lastName} manually ${input.action === 'CLOCK_IN' ? 'clocked in' : 'clocked out'}`,
    };
  }

  async editAttendance(
    recordId: string,
    input: {
      checkInTime?: string;
      checkOutTime?: string;
      note: string;
      markPresent?: boolean;
    },
    currentUser: JWTPayload
  ) {
    if (!currentUser.organizationId) {
      throw new ValidationError(
        'Organization context required to edit attendance records',
        'ORG_REQUIRED'
      );
    }

    const record = await prisma.attendanceRecord.findFirst({
      where: { id: recordId, organizationId: currentUser.organizationId },
    });

    if (!record) throw new NotFoundError('Attendance record not found');

    // ── Role-based field restrictions ──────────────────────────────────────
    // ORG_ACCOUNTANT: can only edit checkOutTime on AUTO_CLOSED records.
    // ORG_ADMIN / SUPER_ADMIN: can edit any field on any record.
    if (currentUser.role === 'ORG_ACCOUNTANT') {
      if (record.status !== 'AUTO_CLOSED') {
        throw new ValidationError(
          'Accountants can only edit AUTO_CLOSED attendance records.',
          'INSUFFICIENT_PERMISSION'
        );
      }
      if (input.checkInTime) {
        throw new ValidationError(
          'Accountants can only modify check-out time, not check-in time.',
          'INSUFFICIENT_PERMISSION'
        );
      }
       if (record.reviewedByAccountant) {
          throw new ValidationError(
            'This record has been acknowledged and can no longer be edited by accountants. Contact the organization admin.',
            'RECORD_ACKNOWLEDGED'
          );
        }
    }

    const updateData: Record<string, unknown> = {
      modifiedBy: currentUser.userId,
      modifiedAt: new Date(),
      modificationNote: input.note,
    };

    if (!record.originalCheckIn) updateData.originalCheckIn = record.checkInTime;
    if (!record.originalCheckOut && record.checkOutTime)
      updateData.originalCheckOut = record.checkOutTime;

    let resolvedCheckIn: Date = record.checkInTime;
    if (input.checkInTime) {
      resolvedCheckIn = validateTimestamp(input.checkInTime, 'checkInTime');
      updateData.checkInTime = resolvedCheckIn;
    }

    if (input.checkOutTime) {
      const resolvedCheckOut = validateTimestamp(input.checkOutTime, 'checkOutTime');
      if (resolvedCheckOut <= resolvedCheckIn)
        throw new ValidationError(
          'checkOutTime must be after checkInTime',
          'INVALID_TIME_RANGE'
        );
      updateData.checkOutTime = resolvedCheckOut;
      updateData.status = 'CHECKED_OUT';
      updateData.duration = Math.round(
        (resolvedCheckOut.getTime() - resolvedCheckIn.getTime()) / (1000 * 60)
      );
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: updateData,
      include: {
        membership: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    log.info(
      { recordId, adminId: currentUser.userId, role: currentUser.role, note: input.note },
      'Attendance record edited'
    );

    const bs = adToBS(resolvedCheckIn);
    this.flagPayrollAfterAttendanceChange(
      record.membershipId,
      record.organizationId,
      bs.year,
      bs.month,
      currentUser.userId,
      recordId,
      `Attendance record ${recordId} edited by ${currentUser.role}: ${input.note}`
    );

    return {
      ...updated,
      user: {
        firstName: updated.membership.user.firstName,
        lastName: updated.membership.user.lastName,
        employeeId: updated.membership.employeeId,
      },
    };
  }

  async acknowledgeAttendance(recordId: string, currentUser: JWTPayload) {
      if (!currentUser.organizationId) {
        throw new ValidationError('Organization context required', 'ORG_REQUIRED');
      }
      if (currentUser.role !== 'ORG_ACCOUNTANT') {
        throw new ValidationError(
          'Only accountants can acknowledge records.',
          'INSUFFICIENT_PERMISSION'
        );
      }
      const record = await prisma.attendanceRecord.findFirst({
        where: { id: recordId, organizationId: currentUser.organizationId },
      });
      if (!record) throw new NotFoundError('Attendance record not found');
      if (record.status !== 'AUTO_CLOSED') {
        throw new ValidationError(
          'Only AUTO_CLOSED records can be acknowledged.',
          'INVALID_STATUS'
        );
      }
      if (record.reviewedByAccountant) {
        throw new ValidationError('Record already acknowledged.', 'ALREADY_ACKNOWLEDGED');
      }
      const updated = await prisma.attendanceRecord.update({
        where: { id: recordId },
        data: {
          reviewedByAccountant: true,
          reviewedAt: new Date(),
        },
      });
      return {
        id: updated.id,
        reviewedByAccountant: true,
        reviewedAt: updated.reviewedAt,
      };
    }

    async markPresent(
    input: {
      userId: string;
      date: string;
      checkInTime: string;
      checkOutTime?: string;
      note: string;
    },
    currentUser: JWTPayload
  ) {
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId: input.userId,
        organizationId: currentUser.organizationId!,
        isActive: true,
        deletedAt: null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!membership)
      throw new NotFoundError('Employee not found or not active in this organization');

    const checkIn = validateTimestamp(input.checkInTime, 'checkInTime');

    let checkOut: Date | null = null;
    if (input.checkOutTime) {
      checkOut = validateTimestamp(input.checkOutTime, 'checkOutTime');
      if (checkOut <= checkIn)
        throw new ValidationError(
          'checkOutTime must be after checkInTime',
          'INVALID_TIME_RANGE'
        );
    }

    const dateStart = new Date(input.date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(input.date);
    dateEnd.setHours(23, 59, 59, 999);

    if (isNaN(dateStart.getTime()))
      throw new ValidationError('date is not a valid date', 'INVALID_DATE');

    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        membershipId: membership.id,
        organizationId: currentUser.organizationId!,
        checkInTime: { gte: dateStart, lte: dateEnd },
        isActive: true,
      },
    });

    if (existing) throw new ConflictError('Attendance record already exists for this date');

    const duration = checkOut
      ? Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60))
      : null;
    const bs = adToBS(checkIn);

    const record = await prisma.attendanceRecord.create({
      data: {
        membershipId: membership.id,
        organizationId: currentUser.organizationId!,
        checkInTime: checkIn,
        checkOutTime: checkOut,
        checkInMethod: 'MANUAL',
        checkOutMethod: checkOut ? 'MANUAL' : undefined,
        duration,
        status: checkOut ? 'CHECKED_OUT' : 'CHECKED_IN',
        isManualEntry: true,
        modifiedBy: currentUser.userId,
        modifiedAt: new Date(),
        modificationNote: input.note,
        notes: 'Manual entry: ' + input.note,
        bsYear: bs.year,
        bsMonth: bs.month,
        bsDay: bs.day,
      },
    });

    log.info(
      { membershipId: membership.id, adminId: currentUser.userId, date: input.date },
      'Employee marked present by admin'
    );

    const payrollFlag = await payrollService.flagPayrollNeedsRecalculation(
      membership.id,
      currentUser.organizationId!,
      bs.year,
      bs.month,
      currentUser.userId,
      record.id,
      `Admin marked employee present for ${input.date}: ${input.note}`
    );

    return {
      record: {
        ...record,
        user: {
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          employeeId: membership.employeeId,
        },
      },
      payrollWarning: payrollFlag.flagged
        ? `A payslip for ${bs.year}/${bs.month} already existed (was: ${payrollFlag.previousStatus}). It has been flagged for recalculation — please regenerate it before the next payroll run.`
        : null,
    };
  }

  // ======== Read methods ========

  async getStatus(membershipId: string) {
    const openRecord = await prisma.attendanceRecord.findFirst({
      where: { membershipId, status: 'CHECKED_IN' },
      select: { id: true, checkInTime: true, checkInMethod: true },
    });

    if (openRecord) {
      const durationMs = Date.now() - openRecord.checkInTime.getTime();
      const durationMinutes = Math.floor(durationMs / 60000);
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      return {
        isClockedIn: true,
        record: openRecord,
        currentDuration: { minutes: durationMinutes, formatted: `${hours}h ${minutes}m` },
      };
    }

    return { isClockedIn: false, record: null, currentDuration: null };
  }

  async getMyAttendance(
  membershipId: string,
  limit: number,
  offset: number,
  filters?: { bsYear?: number; bsMonth?: number }
) {
  const where: Record<string, unknown> = { membershipId };
  if (filters?.bsYear)  where.bsYear  = filters.bsYear;
  if (filters?.bsMonth) where.bsMonth = filters.bsMonth;

  const [records, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      select: {
        id: true,
        checkInTime: true,
        checkOutTime: true,
        checkInMethod: true,
        checkOutMethod: true,
        duration: true,
        status: true,
        isActive: true,
        notes: true,
        bsYear: true,
        bsMonth: true,
        bsDay: true,
      },
      // asc for monthly calendar view; the dashboard uses desc for "recent first"
      orderBy: { checkInTime: filters?.bsYear ? 'asc' : 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.attendanceRecord.count({ where }),
  ]);

  // Summary stats — only computed when filtering by a specific month
  let summary: {
    daysPresent: number;
    totalMinutes: number;
    lateCount: number;
    workStartTime: string | null;
  } | null = null;

  if (filters?.bsYear && filters?.bsMonth) {
    const membership = await prisma.orgMembership.findUnique({
      where: { id: membershipId },
      include: {
        organization: {
          select: { workStartTime: true, lateThresholdMinutes: true },
        },
      },
    });

    const workStartTime = membership?.organization.workStartTime ?? null;
    const lateThreshold = membership?.organization.lateThresholdMinutes ?? 10;

    const daysPresent  = records.length;
    const totalMinutes = records.reduce((sum, r) => sum + (r.duration ?? 0), 0);

    let lateCount = 0;
    if (workStartTime) {
      const [startHour, startMinute] = workStartTime.split(':').map(Number);
      lateCount = records.filter((r) => {
        if (!r.checkInTime) return false;
        const checkIn   = new Date(r.checkInTime);
        const workStart = new Date(checkIn);
        workStart.setHours(startHour, startMinute, 0, 0);
        return Math.floor((checkIn.getTime() - workStart.getTime()) / 60000) > lateThreshold;
      }).length;
    }

    summary = { daysPresent, totalMinutes, lateCount, workStartTime };
  }

  return {
    records,
    pagination: { total, limit, offset, hasMore: offset + records.length < total },
    summary,
  };
}

  async listAttendance(
    currentUser: JWTPayload,
    limit: number,
    offset: number,
    filters: { userId?: string; status?: string; date?: string }
  ) {
    const where: Record<string, unknown> = {};

    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }

    if (filters.userId) {
      const orgId =
        currentUser.role !== 'SUPER_ADMIN' ? currentUser.organizationId! : undefined;
      const memberships = await prisma.orgMembership.findMany({
        where: {
          userId: filters.userId,
          ...(orgId ? { organizationId: orgId } : {}),
        },
        select: { id: true },
      });
      if (memberships.length === 0) {
        return { records: [], pagination: { total: 0, limit, offset, hasMore: false } };
      }
      where.membershipId = { in: memberships.map((m) => m.id) };
    }

    if (filters.status) where.status = filters.status;

    if (filters.date) {
      const [y, m, d] = filters.date.split('-').map(Number);
      const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
      const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
      where.checkInTime = { gte: startOfDay, lte: endOfDay };
    }

    const [rawRecords, total] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        include: {
          membership: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
        orderBy: { checkInTime: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.attendanceRecord.count({ where }),
    ]);

    const records = rawRecords.map((r) => ({
      id: r.id,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      checkInMethod: r.checkInMethod,
      checkOutMethod: r.checkOutMethod,
      duration: r.duration,
      status: r.status,
      isActive: r.isActive,
      notes: r.notes,
      bsYear: r.bsYear,
      bsMonth: r.bsMonth,
      bsDay: r.bsDay,
      isManualEntry: r.isManualEntry,
      modifiedBy: r.modifiedBy,
      modificationNote: r.modificationNote,
      originalCheckIn: r.originalCheckIn,
      originalCheckOut: r.originalCheckOut,
      reviewedByAccountant: r.reviewedByAccountant,
        reviewedAt: r.reviewedAt,
      user: {
        id: r.membership.user.id,
        firstName: r.membership.user.firstName,
        lastName: r.membership.user.lastName,
        employeeId: r.membership.employeeId,
        email: r.membership.user.email,
      },
    }));

    return {
      records,
      pagination: { total, limit, offset, hasMore: offset + records.length < total },
    };
  }

  // ======== Private helpers ========

  private async validateQRPayloadAndGetOrg(qrPayload: string): Promise<string> {
    const parsed = parseQRPayload(qrPayload);
    if (!parsed)
      throw new ValidationError('Invalid QR code format', 'INVALID_QR_FORMAT');

    // Signature check removed in PR 6 — see lib/crypto.ts comment.
    // Any tampering with the token just produces a DB miss below.
    const { token } = parsed;

    const qrCode = await prisma.qRCode.findUnique({ where: { token } });
    if (!qrCode) throw new ValidationError('QR code not found', 'QR_NOT_FOUND');
    if (qrCode.status !== 'ACTIVE')
      throw new ValidationError('QR code has been revoked', 'QR_REVOKED');
    if (qrCode.expiresAt && qrCode.expiresAt < new Date())
      throw new ValidationError('QR code has expired', 'QR_EXPIRED');

    return qrCode.organizationId;
  }

  private async incrementQRScanCount(qrPayload: string) {
    const parsed = parseQRPayload(qrPayload);
    if (!parsed) return;
    await prisma.qRCode.updateMany({
      where: { token: parsed.token, status: 'ACTIVE' },
      data: { scanCount: { increment: 1 } },
    });
  }

  private async validateQRPayload(qrPayload: string, organizationId: string) {
    const parsed = parseQRPayload(qrPayload);
    if (!parsed)
      throw new ValidationError('Invalid QR code format', 'INVALID_QR_FORMAT');

    // Signature check removed in PR 6 — see lib/crypto.ts comment.
    const { token } = parsed;

    const qrCode = await prisma.qRCode.findUnique({ where: { token } });
    if (!qrCode) throw new ValidationError('QR code not found', 'QR_NOT_FOUND');
    if (qrCode.status !== 'ACTIVE')
      throw new ValidationError('QR code has been revoked', 'QR_REVOKED');
    if (qrCode.expiresAt && qrCode.expiresAt < new Date())
      throw new ValidationError('QR code has expired', 'QR_EXPIRED');
    if (qrCode.organizationId !== organizationId)
      throw new ValidationError(
        'QR code does not belong to your organization',
        'QR_ORG_MISMATCH'
      );

    await prisma.qRCode.update({
      where: { id: qrCode.id },
      data: { scanCount: { increment: 1 } },
    });
  }

  private async checkAndNotifyLateArrival(
    membershipId: string,
    organizationId: string,
    checkInTime: Date,
    attendanceId: string
  ) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { workStartTime: true, lateThresholdMinutes: true },
      });
      if (!org || !org.workStartTime) return;

      const membership = await prisma.orgMembership.findUnique({
        where: { id: membershipId },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!membership) return;

      const [startHour, startMinute] = org.workStartTime.split(':').map(Number);
      const workStart = new Date(checkInTime);
      workStart.setHours(startHour, startMinute, 0, 0);

      const minutesLate = Math.floor(
        (checkInTime.getTime() - workStart.getTime()) / 60000
      );
      const threshold = org.lateThresholdMinutes || 10;

      if (minutesLate > threshold) {
        const userName = `${membership.user.firstName} ${membership.user.lastName}`;
        await notificationService.createLateArrivalNotification(
          organizationId,
          membershipId,
          userName,
          minutesLate,
          checkInTime,
          attendanceId
        );
        log.info(
          { membershipId, userName, minutesLate, checkInTime },
          'Late arrival notification created'
        );
      }
    } catch (error) {
      log.error(
        { error, membershipId, organizationId },
        'Failed to check/notify late arrival'
      );
    }
  }

  /**
   * Core clock-in/out logic in a Serializable transaction.
   *
   * Changes (Point 2 — Auto-Close Cap):
   * - Auto-close of previous day's open record now caps checkOutTime at shift end
   *   time (membershipData.shiftEndTime || org.workEndTime) instead of midnight.
   *   This prevents false overtime when an employee forgets to clock out.
   * - membershipData is now fetched BEFORE the auto-close so the same query result
   *   is reused for both the cap logic and the clock-in restriction check.
   */
  private async performClockActionSafe(
    membershipId: string,
    organizationId: string,
    method: 'QR_SCAN' | 'MANUAL' | 'MOBILE_CHECKIN'
  ) {
    return prisma.$transaction(
      async (tx) => {
        const { todayStart, todayEnd } = getTodayRangeNPT();

        // ── Daily check-in limit (org-configured, null = unlimited) ─────────
        // Fetched once here and reused at both clock-in paths below.
        // Clock-OUT is never blocked by this limit — only new clock-INs are.
        const orgConfig = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { maxDailyCheckins: true, autoCloseGraceMinutes: true },
        });

        const checkDailyLimit = async () => {
          if (orgConfig?.maxDailyCheckins == null) return; // unlimited
          const todayCheckinCount = await tx.attendanceRecord.count({
            where: {
              membershipId,
              checkInTime: { gte: todayStart, lte: todayEnd },
            },
          });
          if (todayCheckinCount >= orgConfig.maxDailyCheckins) {
            throw new ValidationError(
              `Daily check-in limit of ${orgConfig.maxDailyCheckins} reached for today.`,
              'DAILY_LIMIT_REACHED'
            );
          }
        };

        // ── Cooldown check ───────────────────────────────────────────────────
        const cooldownTime = new Date(Date.now() - SCAN_COOLDOWN_MINUTES * 60 * 1000);
        const recentAction = await tx.attendanceRecord.findFirst({
          where: {
            membershipId,
            OR: [
              { checkInTime: { gte: cooldownTime } },
              { checkOutTime: { gte: cooldownTime } },
            ],
          },
          orderBy: { checkInTime: 'desc' },
        });

        if (recentAction) {
          const lastActionTime = recentAction.checkOutTime || recentAction.checkInTime;
          const timeSince = Math.floor((Date.now() - lastActionTime.getTime()) / 1000);
          const waitTime = SCAN_COOLDOWN_MINUTES * 60 - timeSince;
          if (waitTime > 0)
            throw new ValidationError(
              `Please wait ${Math.ceil(waitTime / 60)} minute(s) before scanning again`,
              'COOLDOWN_ACTIVE'
            );
        }

        // ── Auto-close previous day's open record ────────────────────────────
        const openRecord = await tx.attendanceRecord.findFirst({
          where: { membershipId, status: 'CHECKED_IN' },
        });

        if (openRecord) {
          // Fetch membership data up-front — needed to determine shift end for
          // the window-based forgotten-check AND the CLOCKIN_CLOSED guard below.
          const membershipData = await tx.orgMembership.findUnique({
            where: { id: membershipId },
            include: { organization: { select: { workEndTime: true } } },
          });
          const endTimeStr =
            membershipData?.shiftEndTime || membershipData?.organization.workEndTime;

          // ── Determine if this is a forgotten clock-out ─────────────────────
          //
          // OLD logic: isFromPreviousDay = checkInTime < midnight (todayStart)
          //   Problem: treats night-shift clock-outs (e.g. 8pm→2am) as forgotten
          //   because midnight passes between clock-in and clock-out.
          //
          // NEW logic: isForgotten = now > shiftEnd + AUTO_CLOSE_GRACE_MINUTES
          //   • Night shifts (shift end crosses midnight) are detected via the
          //     cross-midnight correction (shiftEnd += 1 day when end ≤ clockIn).
          //   • Overtime stays are allowed as long as within the grace window.
          //   • Only genuine forgot cases (well past shift end + grace) are closed.
          //   • Falls back to the midnight boundary when no shift end is configured.
          const now = new Date();
          let isForgotten: boolean;

          if (endTimeStr) {
            const [endHour, endMinute] = endTimeStr.split(':').map(Number);
            // Build shift end from the clock-in date
            const shiftEnd = new Date(openRecord.checkInTime);
            shiftEnd.setHours(endHour, endMinute, 0, 0);
            // Cross-midnight shift: if computed end is ≤ clock-in, it rolls to next day
            if (shiftEnd <= openRecord.checkInTime) {
              shiftEnd.setDate(shiftEnd.getDate() + 1);
            }
            // Within grace window → employee is still working (overtime or night shift)
            const graceMinutes = orgConfig?.autoCloseGraceMinutes ?? 240;
            const graceDeadline = new Date(shiftEnd.getTime() + graceMinutes * 60000);
            isForgotten = now > graceDeadline;
          } else {
            // No shift end configured → safe fallback: midnight boundary
            isForgotten = openRecord.checkInTime < todayStart;
          }

          if (isForgotten) {
            // ── Auto-close the forgotten record ─────────────────────────────
            // Cap at shift end (cross-midnight aware) to avoid false overtime.
            // If no shift end is known, cap at 23:59:59.999 of the clock-in day.
            let autoCloseTime: Date;

            if (endTimeStr) {
              const [endHour, endMinute] = endTimeStr.split(':').map(Number);
              const shiftEnd = new Date(openRecord.checkInTime);
              shiftEnd.setHours(endHour, endMinute, 0, 0);
              if (shiftEnd <= openRecord.checkInTime) {
                shiftEnd.setDate(shiftEnd.getDate() + 1);
              }
              autoCloseTime = shiftEnd;
            } else {
              autoCloseTime = new Date(todayStart.getTime() - 1); // 23:59:59.999 of clock-in day
            }

            const duration = Math.floor(
              (autoCloseTime.getTime() - openRecord.checkInTime.getTime()) / 60000
            );

            await tx.attendanceRecord.update({
              where: { id: openRecord.id },
              data: {
                checkOutTime: autoCloseTime,
                checkOutMethod: 'MANUAL',
                duration,
                status: 'AUTO_CLOSED',
                notes:
                  'Auto-closed: employee did not clock out. ' +
                  `Check-out capped at shift end (${autoCloseTime.toTimeString().slice(0, 5)}).`,
              },
            });

            log.warn(
              {
                membershipId,
                recordId: openRecord.id,
                autoCloseTime: autoCloseTime.toISOString(),
                durationMinutes: duration,
              },
              'Previous day record auto-closed (capped at shift end)'
            );

            // Check clock-in restriction using the already-fetched endTimeStr
            if (endTimeStr) {
              const [endHour, endMinute] = endTimeStr.split(':').map(Number);
              const nowCi = new Date();
              const shiftEndToday = new Date(nowCi);
              shiftEndToday.setHours(endHour, endMinute, 0, 0);
              // Cross-midnight shift (e.g. ends at 02:00): shiftEnd falls in early AM.
              // If it is already past that time, roll to tomorrow so the employee is
              // not blocked from clocking in for their upcoming night-shift cycle.
              if (shiftEndToday < nowCi && endHour < 12) {
                shiftEndToday.setDate(shiftEndToday.getDate() + 1);
              }
              if (nowCi > shiftEndToday) {
                throw new ValidationError(
                  'Clock-in is closed for today. See you tomorrow!',
                  'CLOCKIN_CLOSED'
                );
              }
            }

            // Check daily limit before creating new clock-in
            await checkDailyLimit();

            // Proceed to clock in fresh
            const clockInNow = new Date();
            const bs = adToBS(clockInNow);
            const newRecord = await tx.attendanceRecord.create({
              data: {
                membershipId,
                organizationId,
                checkInMethod: method,
                status: 'CHECKED_IN',
                bsYear: bs.year,
                bsMonth: bs.month,
                bsDay: bs.day,
              },
              include: {
                membership: {
                  include: { user: { select: { firstName: true, lastName: true } } },
                },
              },
            });

            return {
              action: 'CLOCK_IN' as const,
              record: {
                ...newRecord,
                user: {
                  firstName: newRecord.membership.user.firstName,
                  lastName: newRecord.membership.user.lastName,
                  employeeId: newRecord.membership.employeeId,
                },
              },
            };
          }

          // ── Clock OUT (open record is from today) ────────────────────────
          const checkOutTime = new Date();
          const durationMinutes = Math.floor(
            (checkOutTime.getTime() - openRecord.checkInTime.getTime()) / 60000
          );
          const record = await tx.attendanceRecord.update({
            where: { id: openRecord.id },
            data: {
              checkOutTime,
              checkOutMethod: method,
              duration: durationMinutes,
              status: 'CHECKED_OUT',
            },
            include: {
              membership: {
                include: { user: { select: { firstName: true, lastName: true } } },
              },
            },
          });

          return {
            action: 'CLOCK_OUT' as const,
            record: {
              ...record,
              user: {
                firstName: record.membership.user.firstName,
                lastName: record.membership.user.lastName,
                employeeId: record.membership.employeeId,
              },
            },
          };
        }

        // ── Clock IN (no open record) ────────────────────────────────────────
        const membershipData = await tx.orgMembership.findUnique({
          where: { id: membershipId },
          include: { organization: { select: { workEndTime: true } } },
        });
        const endTime =
          membershipData?.shiftEndTime || membershipData?.organization.workEndTime;
        if (endTime) {
          const [endHour, endMinute] = endTime.split(':').map(Number);
          const nowCi = new Date();
          const shiftEnd = new Date(nowCi);
          shiftEnd.setHours(endHour, endMinute, 0, 0);
          // Cross-midnight shift: roll end to tomorrow if already past and
          // it is an early-AM time — prevents blocking night-shift clock-ins.
          if (shiftEnd < nowCi && endHour < 12) {
            shiftEnd.setDate(shiftEnd.getDate() + 1);
          }
          if (nowCi > shiftEnd) {
            throw new ValidationError(
              'Clock-in is closed for today. See you tomorrow!',
              'CLOCKIN_CLOSED'
            );
          }
        }

        // Check daily limit before creating new clock-in
        await checkDailyLimit();

        const now = new Date();
        const bs = adToBS(now);
        const record = await tx.attendanceRecord.create({
          data: {
            membershipId,
            organizationId,
            checkInMethod: method,
            status: 'CHECKED_IN',
            bsYear: bs.year,
            bsMonth: bs.month,
            bsDay: bs.day,
          },
          include: {
            membership: {
              include: { user: { select: { firstName: true, lastName: true } } },
            },
          },
        });

        return {
          action: 'CLOCK_IN' as const,
          record: {
            ...record,
            user: {
              firstName: record.membership.user.firstName,
              lastName: record.membership.user.lastName,
              employeeId: record.membership.employeeId,
            },
          },
        };
      },
      { isolationLevel: 'Serializable' }
    );
  }

  private flagPayrollAfterAttendanceChange(
    membershipId: string,
    organizationId: string,
    bsYear: number,
    bsMonth: number,
    triggeredBy: string,
    attendanceRecordId: string,
    reason: string
  ) {
    payrollService
      .flagPayrollNeedsRecalculation(
        membershipId,
        organizationId,
        bsYear,
        bsMonth,
        triggeredBy,
        attendanceRecordId,
        reason
      )
      .catch((err) =>
        log.error({ err }, 'Failed to flag payroll after attendance correction')
      );
  }

  /**
   * Load the branch-level geofence override for a given membership, if any.
   *
   * Returns null when the employee has no branch assigned, or when the branch
   * has been soft-deleted or deactivated — in those cases the org-level
   * geofence is used as a safe fallback. The pure {@link resolveGeofenceConfig}
   * helper handles the actual merge with the org config.
   */
  private async getMembershipBranchGeo(
    membershipId: string
  ): Promise<BranchGeofenceOverride | null> {
    const m = await prisma.orgMembership.findUnique({
      where: { id: membershipId },
      select: {
        branch: {
          select: {
            officeLat: true,
            officeLng: true,
            geofenceRadius: true,
            deletedAt: true,
            isActive: true,
          },
        },
      },
    });
    const branch = m?.branch;
    if (!branch) return null;
    if (branch.deletedAt || !branch.isActive) return null;
    return {
      officeLat: branch.officeLat,
      officeLng: branch.officeLng,
      geofenceRadius: branch.geofenceRadius,
    };
  }

  private async logAudit(data: {
    employeeId?: string;
    userId?: string;
    organizationId?: string;
    action: string;
    method: string;
    success: boolean;
    failureReason?: string;
    ipAddress?: string;
    userAgent?: string;
    qrToken?: string;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    try {
      await prisma.attendanceAuditLog.create({ data });
    } catch (err) {
      log.error({ err, data }, 'Failed to write audit log');
    }
  }
}

export const attendanceService = new AttendanceService();