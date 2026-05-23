import prisma from '../lib/prisma';
import { NotFoundError, ValidationError } from '../lib/errors';
import { createLogger } from '../logger';

const log = createLogger('leave-balance-service');

// Nepal Labor Act 2074 accumulation caps
const ANNUAL_ACCUMULATION_CAP = 90;
const SICK_ACCUMULATION_CAP   = 45;
// Casual has no legal cap — we use a generous internal cap to prevent runaway data
const CASUAL_ACCUMULATION_CAP = 90;

// Leave types that have balance tracking
const TRACKED_LEAVE_TYPES = new Set(['ANNUAL', 'SICK', 'CASUAL']);

export class LeaveBalanceService {

  // ── Read ────────────────────────────────────────────────────────────────

  /**
   * Get all leave balances for an org + BS year (admin view).
   * Returns one record per active employee, including computed available days.
   */
  async getOrgBalances(organizationId: string, bsYear: number) {
    const balances = await prisma.leaveBalance.findMany({
      where: { organizationId, bsYear },
      include: {
        membership: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { membership: { employeeId: 'asc' } },
    });

    return balances.map((b) => this.withAvailable(b));
  }

  /**
   * Get an employee's own balance for a given BS year.
   * Returns null if leaveBalanceEnabled is false on the org — employee
   * should never see balance info when the feature is disabled.
   */
  async getMyBalance(membershipId: string, organizationId: string, bsYear: number) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leaveBalanceEnabled: true },
    });

    if (!org?.leaveBalanceEnabled) return null;

    const balance = await prisma.leaveBalance.findUnique({
      where: { membershipId_bsYear: { membershipId, bsYear } },
    });

    if (!balance) return null;

    return this.withAvailable(balance);
  }

  // ── Initialize ──────────────────────────────────────────────────────────

  /**
   * Initialize leave balances for all active employees for a given BS year.
   * Called manually by org admin once per year.
   *
   * - Copies entitlements from current org policy.
   * - Carries over unused days from the previous year (capped at legal limits).
   * - Skips employees who already have a balance for this year.
   *
   * Returns a preview if dryRun = true (no DB writes).
   */
  async initializeYear(
    organizationId: string,
    bsYear: number,
    triggeredBy: string,
    dryRun = false
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        leaveBalanceEnabled:    true,
        annualLeaveEntitlement: true,
        sickLeaveEntitlement:   true,
        casualLeaveEntitlement: true,
      },
    });

    if (!org) throw new NotFoundError('Organization not found');
    if (!org.leaveBalanceEnabled) {
      throw new ValidationError(
        'Leave balance tracking is not enabled for this organization.',
        'LEAVE_BALANCE_DISABLED'
      );
    }

    // All active employees in this org
    const memberships = await prisma.orgMembership.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });

    // Existing balances for this year (to skip already-initialized employees)
    const existingBalances = await prisma.leaveBalance.findMany({
      where: { organizationId, bsYear },
      select: { membershipId: true },
    });
    const alreadyInitialized = new Set(existingBalances.map((b) => b.membershipId));

    // Previous year balances for carry-over calculation
    const prevYearBalances = await prisma.leaveBalance.findMany({
      where: { organizationId, bsYear: bsYear - 1 },
    });
    const prevByMembership = new Map(prevYearBalances.map((b) => [b.membershipId, b]));

    const preview: Array<{
      membershipId:     string;
      employeeId:       string | null;
      name:             string;
      annualEntitlement:   number;
      sickEntitlement:     number;
      casualEntitlement:   number;
      annualCarriedOver:   number;
      sickCarriedOver:     number;
      casualCarriedOver:   number;
      annualAvailable:     number;
      sickAvailable:       number;
      casualAvailable:     number;
      skipped:          boolean; // already initialized
      cappedWarning:    boolean; // carry-over was capped
    }> = [];

    for (const m of memberships) {
      const prev = prevByMembership.get(m.id);

      // Carry-over = unused days from previous year, capped so total never
      // exceeds the legal accumulation limit
      let annualCarriedOver = 0;
      let sickCarriedOver   = 0;
      let casualCarriedOver = 0;
      let cappedWarning     = false;

      if (prev) {
        const prevAnnualAvailable = prev.annualEntitlement + prev.annualCarriedOver - prev.annualUsed;
        const prevSickAvailable   = prev.sickEntitlement   + prev.sickCarriedOver   - prev.sickUsed;
        const prevCasualAvailable = prev.casualEntitlement + prev.casualCarriedOver - prev.casualUsed;

        // Max carry-over = legal cap minus this year's fresh entitlement
        const maxAnnualCarryOver = Math.max(0, ANNUAL_ACCUMULATION_CAP - org.annualLeaveEntitlement);
        const maxSickCarryOver   = Math.max(0, SICK_ACCUMULATION_CAP   - org.sickLeaveEntitlement);
        const maxCasualCarryOver = Math.max(0, CASUAL_ACCUMULATION_CAP - org.casualLeaveEntitlement);

        annualCarriedOver = Math.min(Math.max(0, prevAnnualAvailable), maxAnnualCarryOver);
        sickCarriedOver   = Math.min(Math.max(0, prevSickAvailable),   maxSickCarryOver);
        casualCarriedOver = Math.min(Math.max(0, prevCasualAvailable), maxCasualCarryOver);

        // Warn if carry-over was capped (excess will be lost — admin should encash)
        if (
          prevAnnualAvailable > maxAnnualCarryOver ||
          prevSickAvailable   > maxSickCarryOver
        ) {
          cappedWarning = true;
        }
      }

      preview.push({
        membershipId:      m.id,
        employeeId:        m.employeeId,
        name:              `${m.user.firstName} ${m.user.lastName}`,
        annualEntitlement: org.annualLeaveEntitlement,
        sickEntitlement:   org.sickLeaveEntitlement,
        casualEntitlement: org.casualLeaveEntitlement,
        annualCarriedOver,
        sickCarriedOver,
        casualCarriedOver,
        annualAvailable:   org.annualLeaveEntitlement + annualCarriedOver,
        sickAvailable:     org.sickLeaveEntitlement   + sickCarriedOver,
        casualAvailable:   org.casualLeaveEntitlement + casualCarriedOver,
        skipped:           alreadyInitialized.has(m.id),
        cappedWarning,
      });
    }

    if (dryRun) {
      return { preview, created: 0, skipped: preview.filter((p) => p.skipped).length };
    }

    // Write — only for employees not yet initialized
    const toCreate = preview.filter((p) => !p.skipped);
    if (toCreate.length > 0) {
      await prisma.leaveBalance.createMany({
        data: toCreate.map((p) => ({
          membershipId:      p.membershipId,
          organizationId,
          bsYear,
          annualEntitlement: p.annualEntitlement,
          sickEntitlement:   p.sickEntitlement,
          casualEntitlement: p.casualEntitlement,
          annualCarriedOver: p.annualCarriedOver,
          sickCarriedOver:   p.sickCarriedOver,
          casualCarriedOver: p.casualCarriedOver,
          initializedBy:     triggeredBy,
          initializedAt:     new Date(),
        })),
      });
    }

    log.info(
      { organizationId, bsYear, created: toCreate.length, triggeredBy },
      'Leave year initialized'
    );

    return {
      preview,
      created: toCreate.length,
      skipped: preview.filter((p) => p.skipped).length,
    };
  }

  // ── Balance deduction / refund ───────────────────────────────────────────

  /**
   * Called by leave.service.ts after a leave status change.
   * - APPROVED → deduct days from the relevant balance bucket
   * - REJECTED → refund days back (in case it was previously approved and is now being reversed — 
   *   but note: current leave.service only allows PENDING→APPROVED/REJECTED,
   *   so refund path is here for future-proofing and admin override scenarios)
   *
   * Silently skips if:
   *   - leaveBalanceEnabled is false on the org
   *   - leave type is not tracked (UNPAID, MATERNITY, PATERNITY)
   *   - no LeaveBalance record exists for this employee/year (balance not initialized)
   */
  async handleLeaveDecision(
    leaveId: string,
    organizationId: string,
    membershipId: string,
    leaveType: string,
    startDate: Date,
    endDate: Date,
    newStatus: 'APPROVED' | 'REJECTED'
  ) {
    // Skip untracked leave types
    if (!TRACKED_LEAVE_TYPES.has(leaveType)) return;

    // Check feature flag
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leaveBalanceEnabled: true },
    });
    if (!org?.leaveBalanceEnabled) return;

    // Determine BS year from leave start date
    // Use bsStartYear stored on the leave — calculated at creation time
    const leave = await prisma.leave.findUnique({
      where: { id: leaveId },
      select: { bsStartYear: true },
    });
    if (!leave?.bsStartYear) {
      log.warn({ leaveId }, 'Leave has no bsStartYear — cannot update balance');
      return;
    }

    const bsYear = leave.bsStartYear;

    const balance = await prisma.leaveBalance.findUnique({
      where: { membershipId_bsYear: { membershipId, bsYear } },
    });

    // If no balance record exists, skip silently
    // (employee may have joined after year initialization)
    if (!balance) {
      log.warn({ membershipId, bsYear, leaveType }, 'No leave balance record found — skipping deduction');
      return;
    }

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Map leave type to the correct used field
    const field = this.usedField(leaveType);
    if (!field) return;

    if (newStatus === 'APPROVED') {
      // Increment used days
      await prisma.leaveBalance.update({
        where: { membershipId_bsYear: { membershipId, bsYear } },
        data: { [field]: { increment: days } },
      });
      log.info({ membershipId, bsYear, leaveType, days }, 'Leave balance deducted');
    } else if (newStatus === 'REJECTED') {
      // Refund — floor at 0 to prevent negative used counts
      const currentUsed = (balance as any)[field] as number;
      const refunded = Math.max(0, currentUsed - days);
      await prisma.leaveBalance.update({
        where: { membershipId_bsYear: { membershipId, bsYear } },
        data: { [field]: refunded },
      });
      log.info({ membershipId, bsYear, leaveType, days }, 'Leave balance refunded');
    }
  }

  // ── Admin manual adjustment ──────────────────────────────────────────────

  /**
   * Manually adjust a specific leave balance field.
   * Used by org admin for special cases (bonus leave granted, correction, etc.)
   */
  async adjustBalance(
    organizationId: string,
    membershipId: string,
    bsYear: number,
    adjustments: {
      annualEntitlement?:  number;
      sickEntitlement?:    number;
      casualEntitlement?:  number;
      annualCarriedOver?:  number;
      sickCarriedOver?:    number;
      casualCarriedOver?:  number;
      annualUsed?:         number;
      sickUsed?:           number;
      casualUsed?:         number;
    },
    note: string,
    adjustedBy: string
  ) {
    if (!note || note.trim().length < 3) {
      throw new ValidationError('Adjustment note is required (min 3 characters)', 'NOTE_REQUIRED');
    }

    const balance = await prisma.leaveBalance.findUnique({
      where: { membershipId_bsYear: { membershipId, bsYear } },
    });

    if (!balance || balance.organizationId !== organizationId) {
      throw new NotFoundError('Leave balance record not found');
    }

    const updated = await prisma.leaveBalance.update({
      where: { membershipId_bsYear: { membershipId, bsYear } },
      data: {
        ...adjustments,
        lastAdjustedBy: adjustedBy,
        lastAdjustedAt: new Date(),
        adjustmentNote: note.trim(),
      },
    });

    log.info({ organizationId, membershipId, bsYear, adjustments, note, adjustedBy }, 'Leave balance manually adjusted');

    return this.withAvailable(updated);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Appends computed "available" fields to a raw LeaveBalance record.
   * available = entitlement + carriedOver - used (floored at 0)
   */
  private withAvailable(balance: any) {
    const annualAvailable = Math.max(
      0,
      balance.annualEntitlement + balance.annualCarriedOver - balance.annualUsed
    );
    const sickAvailable = Math.max(
      0,
      balance.sickEntitlement + balance.sickCarriedOver - balance.sickUsed
    );
    const casualAvailable = Math.max(
      0,
      balance.casualEntitlement + balance.casualCarriedOver - balance.casualUsed
    );

    return {
      ...balance,
      annualAvailable,
      sickAvailable,
      casualAvailable,
    };
  }

  /** Maps leave type string to the Prisma field name for used days */
  private usedField(leaveType: string): string | null {
    switch (leaveType) {
      case 'ANNUAL':  return 'annualUsed';
      case 'SICK':    return 'sickUsed';
      case 'CASUAL':  return 'casualUsed';
      default:        return null;
    }
  }
}

export const leaveBalanceService = new LeaveBalanceService();