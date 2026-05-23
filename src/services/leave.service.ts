import prisma from '../lib/prisma';
import { adToBS, getBSMonthADRange } from '../lib/nepali-date';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { createLogger } from '../logger';
import { emailService } from './email.service';
import { JWTPayload } from '../lib/jwt';
import { CreateLeaveInput } from '../schemas/leave.schema';
import { leaveBalanceService } from './leaveBalance.service';
import { getBranchScope, branchWhere, resolveBranchFilter } from '../lib/branch-scope';

const log = createLogger('leave-service');

export class LeaveService {
  /**
   * Request leave (any employee with an active membership)
   */
  async requestLeave(input: CreateLeaveInput, currentUser: JWTPayload) {
    const { startDate, endDate, reason, type } = input;

    if (!currentUser.membershipId) {
      throw new ValidationError('Active membership required to request leave', 'NO_MEMBERSHIP');
    }

    if (endDate < startDate) {
      throw new ValidationError('End date cannot be before start date');
    }

    // Check for overlapping requests — scoped to this membershipId
    const overlapping = await prisma.leave.findFirst({
      where: {
        membershipId: currentUser.membershipId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
      },
    });

    if (overlapping) throw new ConflictError('You already have a leave request for this period');

    const bsStart = adToBS(startDate);
    const bsEnd = adToBS(endDate);

    const leave = await prisma.leave.create({
      data: {
        membershipId: currentUser.membershipId,
        organizationId: currentUser.organizationId!,
        startDate,
        endDate,
        reason,
        type,
        status: 'PENDING',
        bsStartYear: bsStart.year,
        bsStartMonth: bsStart.month,
        bsStartDay: bsStart.day,
        bsEndYear: bsEnd.year,
        bsEndMonth: bsEnd.month,
        bsEndDay: bsEnd.day,
      },
      include: {
        membership: {
          select: {
            employeeId: true,
            branchId: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    log.info({ membershipId: currentUser.membershipId, type, durationDays }, 'Leave requested');

    // Email both ORG_ADMINs (any branch) AND BRANCH_ADMINs assigned to the
    // requester's branch. Without the latter, a branch admin would have to
    // manually check /leaves to discover pending requests for their team.
    try {
      const requesterBranchId = leave.membership.branchId;
      const adminMemberships = await prisma.orgMembership.findMany({
        where: {
          organizationId: currentUser.organizationId!,
          isActive: true,
          deletedAt: null,
          OR: [
            { role: 'ORG_ADMIN' },
            ...(requesterBranchId
              ? [{ role: 'BRANCH_ADMIN' as const, branchId: requesterBranchId }]
              : []),
          ],
        },
        include: { user: { select: { email: true, firstName: true } } },
      });

      const org = await prisma.organization.findUnique({
        where: { id: currentUser.organizationId! },
        select: { name: true },
      });

      for (const admin of adminMemberships) {
        emailService
          .sendLeaveRequestNotification({
            adminEmail: admin.user.email,
            adminName: admin.user.firstName,
            employeeName: `${leave.membership.user.firstName} ${leave.membership.user.lastName}`,
            employeeId: leave.membership.employeeId || '',
            leaveType: type,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            reason,
            orgName: org?.name || '',
          })
          .catch(err => log.error({ err }, 'Failed to send leave request email'));
      }
    } catch (err) {
      log.error({ err }, 'Failed to notify admins');
    }

    return {
      leave: {
        ...leave,
        user: {
          firstName: leave.membership.user.firstName,
          lastName: leave.membership.user.lastName,
          employeeId: leave.membership.employeeId,
          email: leave.membership.user.email,
        },
      },
      durationDays,
    };
  }

  /**
   * Approve or reject leave (admin only)
   */
  async updateLeaveStatus(
    leaveId: string,
    status: 'APPROVED' | 'REJECTED',
    currentUser: JWTPayload,
    rejectionMessage?: string
  ) {
    const leave = await prisma.leave.findUnique({
      where: { id: leaveId },
      include: {
        membership: {
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    });

    if (!leave) throw new NotFoundError('Leave request not found');

    if (currentUser.role !== 'SUPER_ADMIN' && leave.organizationId !== currentUser.organizationId) {
      throw new NotFoundError('Leave request not found');
    }

    // BRANCH_ADMIN can only approve/reject leaves for employees in their own
    // branch. Return NotFound (not Forbidden) so we don't leak existence.
    const scope = getBranchScope(currentUser);
    if (scope.branchId && leave.membership.branchId !== scope.branchId) {
      throw new NotFoundError('Leave request not found');
    }

    if (leave.status !== 'PENDING') {
      throw new ValidationError(`Cannot ${status.toLowerCase()} a leave that is already ${leave.status.toLowerCase()}`);
    }

    const updated = await prisma.leave.update({
      where: { id: leaveId },
      data: {
        status,
        ...(rejectionMessage ? { rejectionMessage } : {}),
        approvedBy: currentUser.userId,
        approvedAt: new Date(),
      },
      include: {
        membership: {
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
        },
        approver: { select: { firstName: true, lastName: true } },
      },
    });

    log.info({ leaveId, status, approvedBy: currentUser.userId }, 'Leave status updated');

    // Hook: update leave balance if tracking is enabled for this org.
    // Fire-and-forget — leave approval is never blocked by a balance failure.
    leaveBalanceService
      .handleLeaveDecision(
        leaveId,
        leave.organizationId,
        leave.membershipId,
        leave.type,
        leave.startDate,
        leave.endDate,
        status
      )
      .catch((err) => log.error({ err, leaveId }, 'Failed to update leave balance'));

    try {
      const approverName = (updated.approver?.firstName || '') + ' ' + (updated.approver?.lastName || '');
      emailService
        .sendLeaveDecisionNotification({
          to: updated.membership.user.email,
          employeeName: updated.membership.user.firstName,
          leaveType: updated.type,
          startDate: updated.startDate.toISOString().split('T')[0],
          endDate: updated.endDate.toISOString().split('T')[0],
          status: status as 'APPROVED' | 'REJECTED',
          approverName,
        })
        .catch(err => log.error({ err }, 'Failed to send leave decision email'));
    } catch (err) {
      log.error({ err }, 'Failed to notify employee');
    }

    return {
      ...updated,
      user: {
        firstName: updated.membership.user.firstName,
        lastName: updated.membership.user.lastName,
        employeeId: updated.membership.employeeId,
        email: updated.membership.user.email,
      },
    };
  }

  /**
   * Get my leave requests (employee)
   */
  async getMyLeaves(currentUser: JWTPayload, limit: number, offset: number, status?: string) {
    if (!currentUser.membershipId) {
      return { leaves: [], pagination: { total: 0, limit, offset, hasMore: false } };
    }

    const where: Record<string, unknown> = { membershipId: currentUser.membershipId };
    if (status) where.status = status;

    const [leaves, total] = await Promise.all([
      prisma.leave.findMany({
        where,
        include: { approver: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.leave.count({ where }),
    ]);

    const enriched = leaves.map((l) => ({
      ...l,
      durationDays: Math.ceil((l.endDate.getTime() - l.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    }));

    return { leaves: enriched, pagination: { total, limit, offset, hasMore: offset + leaves.length < total } };
  }

  /**
   * List all leave requests (admin/accountant) — org-scoped
   *
   * Supports filters:
   *   - status: PENDING | APPROVED | REJECTED
   *   - userId: specific user UUID
   *   - type: leave type (SICK, CASUAL, etc.)
   *   - fromDate / toDate: AD date range (leaves overlapping this range)
   *   - search: partial match on employee name or employeeId
   *   - bsYear / bsMonth: filter leaves that overlap a specific BS month
   */
  async listLeaves(
    currentUser: JWTPayload,
    limit: number,
    offset: number,
    filters: {
      status?: string;
      userId?: string;
      type?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
      bsYear?: number;
      bsMonth?: number;
      // Phase 8b — voluntary branch narrowing for ORG_ADMIN/ORG_ACCOUNTANT.
      // Ignored for BRANCH_ADMIN (their scope is already locked).
      branchId?: string;
    }
  ) {
    const where: Record<string, unknown> = {};
    const scope = resolveBranchFilter(currentUser, filters.branchId);

    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }

    // Branch-scope: Leave has no direct branchId, so filter via the membership
    // relation. BRANCH_ADMIN sees only leaves for employees in their branch;
    // ORG_ADMIN/ORG_ACCOUNTANT/SUPER_ADMIN see all (scope.branchId is null)
    // unless they pass an explicit branchId to voluntarily narrow.
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }

    // Status filter
    if (filters.status) where.status = filters.status;

    // Leave type filter
    if (filters.type) where.type = filters.type;

    // User ID filter (exact UUID)
    if (filters.userId) {
      const orgId = currentUser.role !== 'SUPER_ADMIN' ? currentUser.organizationId! : undefined;
      const memberships = await prisma.orgMembership.findMany({
        where: {
          userId: filters.userId,
          ...(orgId ? { organizationId: orgId } : {}),
          ...branchWhere(scope),
        },
        select: { id: true },
      });
      if (memberships.length === 0) {
        return { leaves: [], pagination: { total: 0, limit, offset, hasMore: false } };
      }
      where.membershipId = { in: memberships.map((m) => m.id) };
    }

    // Search by employee name or employeeId
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      const orgId = currentUser.role !== 'SUPER_ADMIN' ? currentUser.organizationId! : undefined;

      const matchingMemberships = await prisma.orgMembership.findMany({
        where: {
          ...(orgId ? { organizationId: orgId } : {}),
          ...branchWhere(scope),
          isActive: true,
          OR: [
            { employeeId: { contains: searchTerm, mode: 'insensitive' } },
            { user: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
            { user: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        select: { id: true },
      });

      if (matchingMemberships.length === 0) {
        return { leaves: [], pagination: { total: 0, limit, offset, hasMore: false } };
      }

      // If userId filter is also set, intersect the results
      if (where.membershipId) {
        const existingIds = (where.membershipId as { in: string[] }).in;
        const searchIds = matchingMemberships.map((m) => m.id);
        const intersection = existingIds.filter((id) => searchIds.includes(id));
        if (intersection.length === 0) {
          return { leaves: [], pagination: { total: 0, limit, offset, hasMore: false } };
        }
        where.membershipId = { in: intersection };
      } else {
        where.membershipId = { in: matchingMemberships.map((m) => m.id) };
      }
    }

    // Date range filter (AD dates — leaves overlapping the range)
    if (filters.fromDate || filters.toDate) {
      const dateConditions: Record<string, unknown> = {};
      if (filters.fromDate) {
        const from = new Date(filters.fromDate);
        if (!isNaN(from.getTime())) {
          dateConditions.endDate = { gte: from };
        }
      }
      if (filters.toDate) {
        const to = new Date(filters.toDate);
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          dateConditions.startDate = { lte: to };
        }
      }
      Object.assign(where, dateConditions);
    }

    // BS year/month filter — convert to AD range and find overlapping leaves
    if (filters.bsYear && filters.bsMonth) {
      try {
        const { start, end } = getBSMonthADRange(filters.bsYear, filters.bsMonth);
        // Leaves overlap if: leave.startDate <= end AND leave.endDate >= start
        // Only apply if no AD date filter is already set (BS filter takes priority)
        if (!filters.fromDate && !filters.toDate) {
          where.startDate = { lte: end };
          where.endDate = { gte: start };
        }
      } catch (err) {
        log.warn({ bsYear: filters.bsYear, bsMonth: filters.bsMonth, err }, 'Invalid BS date for leave filter');
      }
    } else if (filters.bsYear && !filters.bsMonth) {
      // Filter by full BS year — first month to last month
      try {
        const { start } = getBSMonthADRange(filters.bsYear, 1);
        const { end } = getBSMonthADRange(filters.bsYear, 12);
        if (!filters.fromDate && !filters.toDate) {
          where.startDate = { lte: end };
          where.endDate = { gte: start };
        }
      } catch (err) {
        log.warn({ bsYear: filters.bsYear, err }, 'Invalid BS year for leave filter');
      }
    }

    const [rawLeaves, total] = await Promise.all([
      prisma.leave.findMany({
        where,
        include: {
          membership: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          approver: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.leave.count({ where }),
    ]);

    const leaves = rawLeaves.map((l) => ({
      ...l,
      durationDays: Math.ceil((l.endDate.getTime() - l.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      user: {
        id: l.membership.user.id,
        firstName: l.membership.user.firstName,
        lastName: l.membership.user.lastName,
        employeeId: l.membership.employeeId,
        email: l.membership.user.email,
      },
    }));

    return { leaves, pagination: { total, limit, offset, hasMore: offset + leaves.length < total } };
  }

  /**
   * Cancel leave (employee can cancel their own pending leave)
   */
  async cancelLeave(leaveId: string, currentUser: JWTPayload) {
    const leave = await prisma.leave.findUnique({ where: { id: leaveId } });

    if (!leave) throw new NotFoundError('Leave request not found');

    if (leave.membershipId !== currentUser.membershipId) {
      throw new NotFoundError('Leave request not found');
    }

    if (leave.status !== 'PENDING') {
      throw new ValidationError('Can only cancel pending leave requests');
    }

    await prisma.leave.delete({ where: { id: leaveId } });

    log.info({ leaveId, membershipId: currentUser.membershipId }, 'Leave cancelled');

    return { message: 'Leave request cancelled' };
  }

  /**
   * Get leave summary for a membership (used by payroll/reports).
   */
  async getLeaveSummary(membershipId: string, startDate: Date, endDate: Date) {
    const leaves = await prisma.leave.findMany({
      where: {
        membershipId,
        status: 'APPROVED',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    let totalDays = 0;
    const byType: Record<string, number> = {};

    for (const leave of leaves) {
      const leaveStart = leave.startDate > startDate ? leave.startDate : startDate;
      const leaveEnd = leave.endDate < endDate ? leave.endDate : endDate;
      const days = Math.ceil((leaveEnd.getTime() - leaveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      totalDays += days;
      byType[leave.type] = (byType[leave.type] || 0) + days;
    }

    return { totalDays, byType, leaves };
  }
}

export const leaveService = new LeaveService();