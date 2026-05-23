import prisma from '../lib/prisma';
import { JWTPayload } from '../lib/jwt';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { createLogger } from '../logger';
import { CreateRosterScheduleInput, UpdateRosterScheduleInput } from '../schemas/roster.schema';
import { getBranchScope, branchWhere, resolveBranchFilter } from '../lib/branch-scope';

const log = createLogger('roster-service');

// ============================================================
// Types
// ============================================================

/** Per-day shift map: key = weekday number (0=Sun…6=Sat) */
export type DayScheduleMap = Record<number, { start: string; end: string }>;

export interface ResolvedSchedule {
  source: 'employee_roster' | 'org_roster' | 'membership_fields' | 'org_fields';
  scheduleId?: string;
  workingDays: number[];     // derived from Object.keys(daySchedules)
  daySchedules: DayScheduleMap;
  label?: string | null;
}

// ============================================================
// Exported helpers (used by payroll + autoclose)
// ============================================================

/**
 * Safely parse Prisma JsonValue → DayScheduleMap.
 * Tolerates null / malformed DB values gracefully.
 */
export function parseDaySchedules(raw: unknown): DayScheduleMap {
  const result: DayScheduleMap = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const dayNum = Number(key);
      if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6 && val && typeof val === 'object') {
        const entry = val as { start?: unknown; end?: unknown };
        if (typeof entry.start === 'string' && typeof entry.end === 'string') {
          result[dayNum] = { start: entry.start, end: entry.end };
        }
      }
    }
  }
  return result;
}

/**
 * Convert flat org/membership fields into a DayScheduleMap.
 * Used by resolver Levels 3 & 4 so callers always receive the same shape.
 */
function flatToSchedules(workingDays: string, startTime: string, endTime: string): DayScheduleMap {
  const result: DayScheduleMap = {};
  for (const day of workingDays.split(',').map(Number)) {
    if (!isNaN(day) && day >= 0 && day <= 6) {
      result[day] = { start: startTime, end: endTime };
    }
  }
  return result;
}

// ============================================================
// Private helpers
// ============================================================

function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function rangesOverlap(
  aFrom: Date, aTo: Date | null,
  bFrom: Date, bTo: Date | null,
): boolean {
  const aEnd = aTo ?? new Date('9999-12-31');
  const bEnd = bTo ?? new Date('9999-12-31');
  return aFrom <= bEnd && bFrom <= aEnd;
}

function dateInRange(date: Date, from: Date, to: Date | null): boolean {
  if (date < from) return false;
  if (to !== null && date > to) return false;
  return true;
}

// ============================================================
// RosterService
// ============================================================

export class RosterService {
  // ----------------------------------------------------------
  // List schedules for an org
  // ----------------------------------------------------------
  async listSchedules(
    currentUser: JWTPayload,
    filters: {
      membershipId?: string;
      scope?: 'org' | 'employee';
      includeDeleted?: boolean;
      // Phase 8b — ORG_ADMIN may voluntarily narrow to a single branch.
      // Ignored for BRANCH_ADMIN (already locked to their own branch).
      branchId?: string;
    },
  ) {
    const organizationId = currentUser.organizationId!;
    const where: Record<string, unknown> = { organizationId };

    if (!filters.includeDeleted) where.deletedAt = null;

    if (filters.scope === 'org') {
      where.membershipId = null;
    } else if (filters.scope === 'employee') {
      where.membershipId = { not: null };
    } else if (filters.membershipId) {
      where.membershipId = filters.membershipId;
    }

    // Branch-scope: a BRANCH_ADMIN sees org-wide schedules (they apply to
    // their branch too) plus per-employee schedules for employees in their
    // own branch. ORG_ADMIN sees everything unless they voluntarily narrow
    // by passing branchId.
    const branchScope = resolveBranchFilter(currentUser, filters.branchId);
    if (branchScope.branchId) {
      where.OR = [
        { membershipId: null },
        { membership: { branchId: branchScope.branchId } },
      ];
    }

    return prisma.rosterSchedule.findMany({
      where,
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ membershipId: 'asc' }, { effectiveFrom: 'asc' }],
    });
  }

  // ----------------------------------------------------------
  // Get single schedule (scoped to org)
  // ----------------------------------------------------------
  async getSchedule(id: string, currentUser: JWTPayload) {
    const schedule = await prisma.rosterSchedule.findFirst({
      where: { id, organizationId: currentUser.organizationId!, deletedAt: null },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            branchId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!schedule) throw new NotFoundError('Roster schedule not found');

    // Branch-scope check: BRANCH_ADMIN can read org-wide schedules
    // (membershipId null) and per-employee schedules where the employee is in
    // their own branch. Return NotFound (not Forbidden) so we don't leak
    // existence of out-of-branch schedules.
    const branchScope = getBranchScope(currentUser);
    if (
      branchScope.branchId &&
      schedule.membership !== null &&
      schedule.membership.branchId !== branchScope.branchId
    ) {
      throw new NotFoundError('Roster schedule not found');
    }

    return schedule;
  }

  // ----------------------------------------------------------
  // Create schedule
  // ----------------------------------------------------------
  async createSchedule(input: CreateRosterScheduleInput, currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    // Branch-scope write guards:
    //  - BRANCH_ADMIN cannot create org-wide schedules (those affect employees
    //    outside their branch).
    //  - BRANCH_ADMIN can only target memberships in their own branch — the
    //    membership lookup below uses branchWhere(scope) so an out-of-branch
    //    target returns NotFoundError (same behavior as ORG_ADMIN trying to
    //    target a cross-org membership).
    const branchScope = getBranchScope(currentUser);
    if (branchScope.branchId && !input.membershipId) {
      throw new ConflictError(
        'Branch admins cannot create organization-wide schedules.',
        'BRANCH_ADMIN_ORG_SCOPE_FORBIDDEN',
      );
    }

    if (input.membershipId) {
      const membership = await prisma.orgMembership.findFirst({
        where: {
          id: input.membershipId,
          organizationId,
          deletedAt: null,
          ...branchWhere(branchScope),
        },
      });
      if (!membership) throw new NotFoundError('Employee membership not found in this organization');
    }

    const effectiveFrom = dateOnly(input.effectiveFrom);
    const effectiveTo   = input.effectiveTo ? dateOnly(input.effectiveTo) : null;

    await this._assertNoOverlap({
      organizationId,
      membershipId: input.membershipId ?? null,
      newDaySchedules: input.daySchedules,
      effectiveFrom,
      effectiveTo,
      excludeId: undefined,
    });

    const schedule = await prisma.rosterSchedule.create({
      data: {
        organizationId,
        membershipId:  input.membershipId ?? null,
        cycleType:     input.cycleType,
        daySchedules:  input.daySchedules,
        effectiveFrom,
        effectiveTo,
        label:         input.label ?? null,
        createdBy:     currentUser.userId,
      },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    log.info({ scheduleId: schedule.id, organizationId, scope: input.membershipId ? 'employee' : 'org' }, 'Roster schedule created');
    return schedule;
  }

  // ----------------------------------------------------------
  // Update schedule
  // ----------------------------------------------------------
  async updateSchedule(id: string, input: UpdateRosterScheduleInput, currentUser: JWTPayload) {
    const existing = await this.getSchedule(id, currentUser);

    const effectiveFrom = input.effectiveFrom ? dateOnly(input.effectiveFrom) : existing.effectiveFrom;
    const effectiveTo   =
      'effectiveTo' in input
        ? input.effectiveTo ? dateOnly(input.effectiveTo) : null
        : existing.effectiveTo;

    if ('membershipId' in input && input.membershipId !== undefined &&
        input.membershipId !== existing.membershipId) {
      throw new ValidationError(
        'Schedule scope (membershipId) cannot be changed after creation. Delete and recreate instead.',
        'SCOPE_IMMUTABLE',
      );
    }

    const newDaySchedules = input.daySchedules ?? (existing.daySchedules as Record<string, { start: string; end: string }>);

    await this._assertNoOverlap({
      organizationId: currentUser.organizationId!,
      membershipId:   existing.membershipId,
      newDaySchedules,
      effectiveFrom,
      effectiveTo,
      excludeId: id,
    });

    const updated = await prisma.rosterSchedule.update({
      where: { id },
      data: {
        cycleType:    input.cycleType    ?? existing.cycleType,
        daySchedules: newDaySchedules,
        effectiveFrom,
        effectiveTo,
        label:        'label' in input ? (input.label ?? null) : existing.label,
        updatedBy:    currentUser.userId,
      },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    log.info({ scheduleId: id, organizationId: currentUser.organizationId }, 'Roster schedule updated');
    return updated;
  }

  // ----------------------------------------------------------
  // Soft-delete
  // ----------------------------------------------------------
  async deleteSchedule(id: string, currentUser: JWTPayload) {
    await this.getSchedule(id, currentUser);
    await prisma.rosterSchedule.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: currentUser.userId },
    });
    log.info({ scheduleId: id, organizationId: currentUser.organizationId }, 'Roster schedule deleted');
  }

  // ----------------------------------------------------------
  // Resolve — 4-level priority, returns DayScheduleMap
  // ----------------------------------------------------------
  async resolveSchedule(
    membershipId: string,
    date: string,
    currentUser: JWTPayload,
  ): Promise<ResolvedSchedule> {
    const organizationId = currentUser.organizationId!;
    const targetDate = dateOnly(date);

    // Branch-scope: BRANCH_ADMIN can only resolve schedules for memberships
    // in their own branch. Out-of-branch lookup returns NotFound, matching
    // the rest of the branch-scoped read pattern.
    const branchScope = getBranchScope(currentUser);
    const membership = await prisma.orgMembership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        deletedAt: null,
        ...branchWhere(branchScope),
      },
      include: {
        organization: {
          select: { workStartTime: true, workEndTime: true, workingDays: true },
        },
      },
    });
    if (!membership) throw new NotFoundError('Employee membership not found');

    const schedules = await prisma.rosterSchedule.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ membershipId }, { membershipId: null }],
      },
    });

    // Level 1: per-employee roster
    const empSchedule = schedules.find(
      (s) => s.membershipId === membershipId && dateInRange(targetDate, s.effectiveFrom, s.effectiveTo),
    );
    if (empSchedule) {
      const daySchedules = parseDaySchedules(empSchedule.daySchedules);
      return {
        source: 'employee_roster',
        scheduleId: empSchedule.id,
        workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b),
        daySchedules,
        label: empSchedule.label,
      };
    }

    // Level 2: org-wide roster
    const orgSchedule = schedules.find(
      (s) => s.membershipId === null && dateInRange(targetDate, s.effectiveFrom, s.effectiveTo),
    );
    if (orgSchedule) {
      const daySchedules = parseDaySchedules(orgSchedule.daySchedules);
      return {
        source: 'org_roster',
        scheduleId: orgSchedule.id,
        workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b),
        daySchedules,
        label: orgSchedule.label,
      };
    }

    // Level 3: flat membership fields
    if (membership.shiftStartTime && membership.shiftEndTime && membership.workingDays) {
      const daySchedules = flatToSchedules(membership.workingDays, membership.shiftStartTime, membership.shiftEndTime);
      return {
        source: 'membership_fields',
        workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b),
        daySchedules,
      };
    }

    // Level 4: flat org fields (always present)
    const org = membership.organization;
    const daySchedules = flatToSchedules(org.workingDays, org.workStartTime, org.workEndTime);
    return {
      source: 'org_fields',
      workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b),
      daySchedules,
    };
  }

  // ----------------------------------------------------------
  // Resolve for payroll — no JWT needed
  // ----------------------------------------------------------
  async resolveScheduleForPayroll(
    membershipId: string,
    organizationId: string,
    date: Date,
  ): Promise<{ workingDays: number[]; daySchedules: DayScheduleMap }> {
    const membership = await prisma.orgMembership.findFirst({
      where: { id: membershipId, organizationId, deletedAt: null },
      include: {
        organization: {
          select: { workStartTime: true, workEndTime: true, workingDays: true },
        },
      },
    });
    if (!membership) throw new NotFoundError('Employee membership not found');

    const schedules = await prisma.rosterSchedule.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ membershipId }, { membershipId: null }],
      },
    });

    // Level 1: per-employee roster
    const empSchedule = schedules.find(
      (s) => s.membershipId === membershipId && dateInRange(date, s.effectiveFrom, s.effectiveTo),
    );
    if (empSchedule) {
      const daySchedules = parseDaySchedules(empSchedule.daySchedules);
      return { workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b), daySchedules };
    }

    // Level 2: org-wide roster
    const orgSchedule = schedules.find(
      (s) => s.membershipId === null && dateInRange(date, s.effectiveFrom, s.effectiveTo),
    );
    if (orgSchedule) {
      const daySchedules = parseDaySchedules(orgSchedule.daySchedules);
      return { workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b), daySchedules };
    }

    // Level 3: flat membership fields
    if (membership.shiftStartTime && membership.shiftEndTime && membership.workingDays) {
      const daySchedules = flatToSchedules(membership.workingDays, membership.shiftStartTime, membership.shiftEndTime);
      return { workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b), daySchedules };
    }

    // Level 4: flat org fields
    const org = membership.organization;
    const daySchedules = flatToSchedules(org.workingDays, org.workStartTime, org.workEndTime);
    return { workingDays: Object.keys(daySchedules).map(Number).sort((a, b) => a - b), daySchedules };
  }

  // ----------------------------------------------------------
  // Internal: assert no overlap within same scope
  // Two schedules conflict only when date ranges AND working days both overlap.
  // This allows e.g. Sunday-only and Monday-only on the same date range.
  // ----------------------------------------------------------
  private async _assertNoOverlap(params: {
    organizationId: string;
    membershipId: string | null;
    newDaySchedules: Record<string, unknown>;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    excludeId: string | undefined;
  }) {
    const { organizationId, membershipId, newDaySchedules, effectiveFrom, effectiveTo, excludeId } = params;

    const candidates = await prisma.rosterSchedule.findMany({
      where: {
        organizationId,
        membershipId: membershipId ?? null,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true, label: true, daySchedules: true },
    });

    const newDays = new Set(Object.keys(newDaySchedules));

    for (const c of candidates) {
      if (!rangesOverlap(effectiveFrom, effectiveTo, c.effectiveFrom, c.effectiveTo)) continue;

      // Date ranges overlap — check if any working day keys also overlap
      const existingDays = Object.keys(c.daySchedules as Record<string, unknown>);
      const hasSharedDay = existingDays.some((d) => newDays.has(d));
      if (!hasSharedDay) continue;

      const scope    = membershipId ? 'this employee' : 'this organization (org-wide)';
      const existing = (c.label ? `"${c.label}"` : `schedule ${c.id.slice(0, 8)}`);
      throw new ConflictError(
        `Date range and working days overlap with existing ${scope} schedule: ${existing}. ` +
        `Adjust the dates, remove the overlapping days, or delete the existing schedule first.`,
        'ROSTER_OVERLAP',
      );
    }
  }
}

export const rosterService = new RosterService();
