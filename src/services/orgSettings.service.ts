import prisma from '../lib/prisma';
import { createLogger } from '../logger';
import { JWTPayload } from '../lib/jwt';
import { NotFoundError, AuthorizationError } from '../lib/errors';

const log = createLogger('org-settings-service');

export class OrgSettingsService {
  /**
   * Get org settings
   */
  async getSettings(currentUser: JWTPayload) {
    if (!currentUser.organizationId) {
      throw new AuthorizationError('No organization associated');
    }

    const org = await prisma.organization.findUnique({
      where: { id: currentUser.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        address: true,
        calendarMode: true,
        language: true,
        isActive: true,
        geofenceEnabled: true,
        officeLat: true,
        officeLng: true,
        geofenceRadius: true,
        attendanceMode:true,
        workStartTime: true,
        workEndTime: true,
        lateThresholdMinutes: true,
        earlyClockInGraceMinutes: true,
        lateClockOutGraceMinutes: true,
        workingDays: true,
        dashainBonusMonth: true,
        dashainBonusPercent: true,
        maxDailyCheckins: true,
        autoCloseGraceMinutes: true,
        // ── Leave Balance Policy ──────────────────────────────────────────
        leaveBalanceEnabled: true,
        annualLeaveEntitlement: true,
        sickLeaveEntitlement: true,
        casualLeaveEntitlement: true,
      },
    });

    if (!org) throw new NotFoundError('Organization not found');

    return org;
  }

  /**
   * Update org settings
   */
  async updateSettings(
    currentUser: JWTPayload,
    input: {
      slug?: string;
      language?: 'NEPALI' | 'ENGLISH';
      calendarMode?: 'NEPALI' | 'ENGLISH';
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      geofenceEnabled?: boolean;
      officeLat?: number | null;
      officeLng?: number | null;
      geofenceRadius?: number;
      workStartTime?: string;
      workEndTime?: string;
      lateThresholdMinutes?: number;
      earlyClockInGraceMinutes?: number;
      lateClockOutGraceMinutes?: number;
      attendanceMode?: 'QR_ONLY' | 'MOBILE_ONLY' | 'BOTH';
      workingDays?: string;
      dashainBonusMonth?: number;
      dashainBonusPercent?: number;
      // null = unlimited; positive integer = cap per day
      maxDailyCheckins?: number | null;
      autoCloseGraceMinutes?: number;
      // ── Leave Balance Policy ────────────────────────────────────────────
      leaveBalanceEnabled?: boolean;
      annualLeaveEntitlement?: number;
      sickLeaveEntitlement?: number;
      casualLeaveEntitlement?: number;
    }
  ) {
    if (!currentUser.organizationId) {
      throw new AuthorizationError('No organization associated');
    }

    const data: Record<string, unknown> = {};

    if (input.language) data.language = input.language;
    if (input.calendarMode) data.calendarMode = input.calendarMode;
    if (input.name) data.name = input.name;

    if (input.slug !== undefined) {
      const cleaned = input.slug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (cleaned.length < 3) throw new AuthorizationError('Slug must be at least 3 characters');
      if (cleaned.length > 50) throw new AuthorizationError('Slug must be less than 50 characters');
      const existing = await prisma.organization.findUnique({ where: { slug: cleaned } });
      if (existing && existing.id !== currentUser.organizationId)
        throw new AuthorizationError('This URL is already taken');
      data.slug = cleaned;
    }

    if (input.email !== undefined) data.email = input.email;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.address !== undefined) data.address = input.address;
    if (input.geofenceEnabled !== undefined) data.geofenceEnabled = input.geofenceEnabled;
    if (input.officeLat !== undefined)
      data.officeLat = input.officeLat ? Number(input.officeLat) : null;
    if (input.officeLng !== undefined)
      data.officeLng = input.officeLng ? Number(input.officeLng) : null;
    if (input.geofenceRadius !== undefined) data.geofenceRadius = Number(input.geofenceRadius);
    if (input.attendanceMode !== undefined) data.attendanceMode = input.attendanceMode;
    if (input.workingDays !== undefined) {
      // Validate format: comma-separated digits 0-6
      const days = input.workingDays.split(',').map((s) => parseInt(s.trim(), 10));
      const valid = days.every((d) => d >= 0 && d <= 6);
      if (valid && days.length > 0) {
        data.workingDays = days.join(',');
      }
    }
    if (input.workStartTime !== undefined) data.workStartTime = input.workStartTime;
    if (input.workEndTime !== undefined) data.workEndTime = input.workEndTime;
    if (input.lateThresholdMinutes !== undefined)
      data.lateThresholdMinutes = Number(input.lateThresholdMinutes);
    if (input.earlyClockInGraceMinutes !== undefined)
      data.earlyClockInGraceMinutes = Number(input.earlyClockInGraceMinutes);
    if (input.lateClockOutGraceMinutes !== undefined)
      data.lateClockOutGraceMinutes = Number(input.lateClockOutGraceMinutes);

    if (input.dashainBonusMonth !== undefined) {
      const month = Number(input.dashainBonusMonth);
      if (month >= 1 && month <= 12) data.dashainBonusMonth = month;
    }
    if (input.dashainBonusPercent !== undefined) {
      const percent = Number(input.dashainBonusPercent);
      if (percent >= 0 && percent <= 200) data.dashainBonusPercent = percent;
    }

    if (input.autoCloseGraceMinutes !== undefined) {
      const v = Number(input.autoCloseGraceMinutes);
      if (v >= 30 && v <= 1440) data.autoCloseGraceMinutes = v;
    }
    if (input.maxDailyCheckins !== undefined) {
      if (input.maxDailyCheckins === null) {
        data.maxDailyCheckins = null; // unlimited
      } else {
        const limit = Number(input.maxDailyCheckins);
        if (Number.isInteger(limit) && limit >= 1 && limit <= 20)
          data.maxDailyCheckins = limit;
      }
    }

    // ── Leave Balance Policy ──────────────────────────────────────────────
    if (input.leaveBalanceEnabled !== undefined)
      data.leaveBalanceEnabled = Boolean(input.leaveBalanceEnabled);
    if (input.annualLeaveEntitlement !== undefined) {
      const days = Number(input.annualLeaveEntitlement);
      if (days >= 0 && days <= 60) data.annualLeaveEntitlement = days;
    }
    if (input.sickLeaveEntitlement !== undefined) {
      const days = Number(input.sickLeaveEntitlement);
      if (days >= 0 && days <= 60) data.sickLeaveEntitlement = days;
    }
    if (input.casualLeaveEntitlement !== undefined) {
      const days = Number(input.casualLeaveEntitlement);
      if (days >= 0 && days <= 60) data.casualLeaveEntitlement = days;
    }

    const org = await prisma.organization.update({
      where: { id: currentUser.organizationId },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        address: true,
        calendarMode: true,
        language: true,
        isActive: true,
        geofenceEnabled: true,
        officeLat: true,
        officeLng: true,
        geofenceRadius: true,
        attendanceMode: true,
        workStartTime: true,
        workEndTime: true,
        lateThresholdMinutes: true,
        earlyClockInGraceMinutes: true,
        lateClockOutGraceMinutes: true,
        workingDays: true,
        dashainBonusMonth: true,
        dashainBonusPercent: true,
        maxDailyCheckins: true,
        autoCloseGraceMinutes: true,
        // ── Leave Balance Policy ──────────────────────────────────────────
        leaveBalanceEnabled: true,
        annualLeaveEntitlement: true,
        sickLeaveEntitlement: true,
        casualLeaveEntitlement: true,
      },
    });

    log.info({ orgId: org.id, changes: Object.keys(data) }, 'Organization settings updated');

    return org;
  }
}

export const orgSettingsService = new OrgSettingsService();