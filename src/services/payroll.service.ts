import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  getBSMonthADRange,
  getEffectiveWorkingDays,
  getDaysInBSMonth,
  BS_MONTHS_EN,
  BS_MONTHS_NP,
} from '../lib/nepali-date';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { createLogger } from '../logger';
import { emailService } from './email.service';
import { JWTPayload } from '../lib/jwt';
import { PaySettingsInput, GeneratePayrollInput } from '../schemas/payroll.schema';
import { holidayService } from './holiday.service';
import { rosterService, parseDaySchedules } from './roster.service';
import { getBranchScope, branchWhere, resolveBranchFilter } from '../lib/branch-scope';

const log = createLogger('payroll-service');

/**
 * Run a Serializable transaction, retrying on serialization failures
 * (Prisma P2034, PostgreSQL SQLSTATE 40001). Up to 2 retries with small
 * randomized backoff so simultaneous admin clicks heal transparently.
 *
 * Any other error propagates without retry. If all retries are exhausted,
 * throws ConflictError so the client sees a 409 and can surface a
 * "please retry" toast rather than a 500.
 */
async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ctx: { op: string }
): Promise<T> {
  const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err: any) {
      // Prisma signals serialization failures with code P2034.
      // See https://www.prisma.io/docs/orm/reference/error-reference#p2034
      const isSerializationFailure = err?.code === 'P2034';
      if (!isSerializationFailure) throw err;

      if (attempt === MAX_ATTEMPTS) {
        log.warn({ op: ctx.op, attempts: attempt }, 'Serialization failure after retries');
        throw new ConflictError(
          'This record is being updated by another user. Please refresh and try again.',
          'CONCURRENT_UPDATE'
        );
      }
      // Jitter: 30–80ms. Tiny sleeps so concurrent clicks don't collide again.
      const jitterMs = 30 + Math.floor(Math.random() * 50);
      log.info({ op: ctx.op, attempt, jitterMs }, 'Serialization failure — retrying');
      await new Promise((r) => setTimeout(r, jitterMs));
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new Error('runSerializable: unreachable');
}

function toNum(val: Decimal | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(val.toString());
}

function validateTDSConfig(config: any): boolean {
  if (!config) return false;
  if (typeof config.firstSlabRate !== 'number' || config.firstSlabRate < 0 || config.firstSlabRate > 50) return false;
  if (!Array.isArray(config.slabs)) return false;
  for (const slab of config.slabs) {
    if (typeof slab.rate !== 'number' || slab.rate < 0 || slab.rate > 50) return false;
    if (slab.limit !== 0 && (typeof slab.limit !== 'number' || slab.limit <= 0)) return false;
  }
  return true;
}

function calculateNepalTDS(
  annualIncome: number,
  isMarried: boolean = false,
  tdsConfig: any,
  ssfEnabled: boolean = false,
): number {
  const config = validateTDSConfig(tdsConfig) ? tdsConfig : null;

  const firstSlabRate = ssfEnabled ? 0 : (config?.firstSlabRate ?? 1) / 100;

  const firstSlab = isMarried
    ? (config?.marriedFirstSlab ?? 600000)
    : (config?.unmarriedFirstSlab ?? 500000);

  const dbSlabs = config?.slabs ?? [
    { limit: 200000, rate: 10 },
    { limit: 300000, rate: 20 },
    { limit: 1000000, rate: 30 },
    { limit: 3000000, rate: 36 },
    { limit: 0, rate: 39 },
  ];

  const slabs = [
    { limit: firstSlab, rate: firstSlabRate },
    ...dbSlabs.map((s: any) => ({
      limit: s.limit === 0 ? Infinity : s.limit,
      rate: s.rate / 100,
    })),
  ];

  let tax = 0;
  let remaining = annualIncome;

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, slab.limit);
    tax += taxable * slab.rate;
    remaining -= taxable;
  }

  return Math.round(tax / 12);
}

function flattenRecordUser(record: any) {
  if (!record.membership) return record;
  const { membership, ...rest } = record;
  return {
    ...rest,
    membershipId: membership.id ?? record.membershipId,
    user: {
      firstName: membership.user?.firstName,
      lastName: membership.user?.lastName,
      email: membership.user?.email,
      employeeId: membership.employeeId,
    },
  };
}

const PAYROLL_RECORD_INCLUDE = {
  membership: {
    select: {
      id: true,
      employeeId: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  },
} as const;

export class PayrollService {

  // ======== Audit logging ========

  async logPayrollAudit(data: {
    organizationId: string;
    payrollRecordId?: string;
    employeeUserId?: string;
    action: 'GENERATED' | 'REGENERATED' | 'STATUS_CHANGED' | 'FLAGGED_NEEDS_RECALCULATION' | 'VOIDED';
    fromStatus?: string;
    toStatus?: string;
    triggeredBy: string;
    triggeredByName?: string;
    reason?: string;
    attendanceRecordId?: string;
    bsYear?: number;
    bsMonth?: number;
  }) {
    try {
      await prisma.payrollAuditLog.create({ data });
    } catch (err) {
      log.error({ err, data }, 'Failed to write payroll audit log');
    }
  }

  // ======== Pay settings ========

  async getPaySettings(currentUser: JWTPayload, branchIdFilter?: string) {
    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const where: Record<string, unknown> = {
      isActive: true,
      leftAt: null,
      role: 'EMPLOYEE',
      ...branchWhere(scope),
    };
    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }

    const memberships = await prisma.orgMembership.findMany({
      where,
      include: {
        paySettings: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            platformId: true,
          },
        },
      },
      orderBy: { user: { firstName: 'asc' } },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      phone: m.user.phone,
      platformId: m.user.platformId,
      membershipId: m.id,
      role: m.role,
      employeeId: m.employeeId,
      isActive: m.isActive,
      organizationId: m.organizationId,
      password: undefined,
      paySettings: m.paySettings
        ? {
          ...m.paySettings,
          basicSalary: toNum(m.paySettings.basicSalary),
          dearnessAllowance: toNum(m.paySettings.dearnessAllowance),
          transportAllowance: toNum(m.paySettings.transportAllowance),
          medicalAllowance: toNum(m.paySettings.medicalAllowance),
          otherAllowances: toNum(m.paySettings.otherAllowances),
          overtimeRatePerHour: toNum(m.paySettings.overtimeRatePerHour),
          employeeSsfRate: toNum(m.paySettings.employeeSsfRate),
          employerSsfRate: toNum(m.paySettings.employerSsfRate),
          employeePfRate: toNum(m.paySettings.employeePfRate),
          employerPfRate: toNum(m.paySettings.employerPfRate),
          citAmount: toNum(m.paySettings.citAmount),
          advanceDeduction: toNum(m.paySettings.advanceDeduction),
        }
        : null,
    }));
  }

  async upsertPaySettings(userId: string, input: PaySettingsInput, currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId;
    if (!organizationId && currentUser.role !== 'SUPER_ADMIN') {
      throw new ValidationError('No organization context');
    }

    // Branch-scope: BRANCH_ADMIN can only edit pay settings for employees
    // in their own branch. Out-of-branch returns NotFoundError.
    const scope = getBranchScope(currentUser);
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId,
        ...(organizationId ? { organizationId } : {}),
        ...branchWhere(scope),
      },
      select: { id: true, organizationId: true },
    });

    if (!membership) throw new NotFoundError('User not found in your organization');

    if (currentUser.role !== 'SUPER_ADMIN' && membership.organizationId !== currentUser.organizationId) {
      throw new NotFoundError('User not found');
    }

    console.log('[upsertPaySettings] input:', JSON.stringify({
      citEnabled: input.citEnabled,
      citAmount: input.citAmount,
      pfEnabled: input.pfEnabled
    }));

    const data = {
      basicSalary: input.basicSalary,
      dearnessAllowance: input.dearnessAllowance,
      transportAllowance: input.transportAllowance,
      medicalAllowance: input.medicalAllowance,
      otherAllowances: input.otherAllowances,
      overtimeRatePerHour: input.overtimeRatePerHour,
      ssfEnabled: input.ssfEnabled,
      employeeSsfRate: input.employeeSsfRate,
      employerSsfRate: input.employerSsfRate,
      tdsEnabled: input.tdsEnabled,
      pfEnabled: input.pfEnabled,
      employeePfRate: input.employeePfRate,
      employerPfRate: input.employerPfRate,
      citEnabled: input.citEnabled,
      citAmount: input.citAmount,
      isMarried: input.isMarried,
      advanceDeduction: input.advanceDeduction,
      dashainBonusPercent: input.dashainBonusPercent ?? null,
      bankName: input.bankName,
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
    };

    const paySettings = await prisma.employeePaySettings.upsert({
      where: { membershipId: membership.id },
      update: data,
      create: { membershipId: membership.id, organizationId: membership.organizationId, ...data },
    });

    return {
      ...paySettings,
      basicSalary: toNum(paySettings.basicSalary),
      dearnessAllowance: toNum(paySettings.dearnessAllowance),
      transportAllowance: toNum(paySettings.transportAllowance),
      medicalAllowance: toNum(paySettings.medicalAllowance),
      otherAllowances: toNum(paySettings.otherAllowances),
      overtimeRatePerHour: toNum(paySettings.overtimeRatePerHour),
      employeeSsfRate: toNum(paySettings.employeeSsfRate),
      employerSsfRate: toNum(paySettings.employerSsfRate),
    };
  }

  // ======== Core payroll calculation ========

  /**
   * Point 3: accepts optional overtimeOverrideHours.
   * When provided, it replaces the calculated overtime hours from attendance.
   * This allows admin/accountant to correct overtime at payroll generation time
   * without modifying attendance records.
   *
   * Statutory deductions are gated by two flags:
   *   - orgAvailability.*  — super-admin controlled, per organization
   *   - paySettings.*Enabled — org-admin controlled, per employee
   * A deduction is applied only when BOTH are true. This way, an org admin's
   * existing per-employee opt-ins are preserved even while the super admin
   * has the deduction disabled for the org, and re-enabling it on the org
   * restores prior behaviour without further admin action.
   */
  private async calculateEmployeePayroll(
    membership: any,
    organizationId: string,
    bsYear: number,
    bsMonth: number,
    adStart: Date,
    adEnd: Date,
    workingDaysInMonth: number,
    holidaysInMonth: number,
    tdsConfig: any,
    orgAvailability: { ssf: boolean; pf: boolean; cit: boolean; tds: boolean },
    overtimeOverrideHours?: number,
    dashainBonusMonth: number = 6,
    dashainBonusPercent: number = 100
  ) {
    const adYear = adStart.getFullYear();
    const adMonth = adStart.getMonth() + 1;
    const s = membership.paySettings!;
    const basicSalary = toNum(s.basicSalary);
    const dearnessAllowance = toNum(s.dearnessAllowance);
    const transportAllowance = toNum(s.transportAllowance);
    const medicalAllowance = toNum(s.medicalAllowance);
    const otherAllowances = toNum(s.otherAllowances);
    const overtimeRatePerHour = toNum(s.overtimeRatePerHour);
    const employeeSsfRate = toNum(s.employeeSsfRate);
    const employerSsfRate = toNum(s.employerSsfRate);

    const { daysPresent, overtimeHours: calculatedOvertimeHours } = await this.getDaysPresent(membership.id, adStart, adEnd);

    // Use override if provided (Point 3), otherwise use calculated value
    const overtimeHours =
      overtimeOverrideHours !== undefined ? overtimeOverrideHours : calculatedOvertimeHours;

    const { paidDays: paidLeaveDays, unpaidDays: unpaidLeaveDays } = await this.getApprovedLeaves(membership.id, adStart, adEnd);
    const effectivePresent = Math.min(workingDaysInMonth, daysPresent + paidLeaveDays);

    if (effectivePresent === 0) {
      return {
        membershipId: membership.id,
        organizationId,
        year: adYear,
        month: adMonth,
        bsYear,
        bsMonth,
        workingDaysInMonth,
        holidaysInMonth,
        daysPresent: 0,
        daysAbsent: workingDaysInMonth,
        paidLeaveDays,
        unpaidLeaveDays,
        overtimeHours: 0,
        basicSalary,
        dearnessAllowance,
        transportAllowance,
        medicalAllowance,
        otherAllowances,
        overtimePay: 0,
        grossSalary: 0,
        absenceDeduction: 0,
        employeeSsf: 0,
        employerSsf: 0,
        tds: 0,
        employeePf: 0,
        employerPf: 0,
        citDeduction: 0,
        advanceDeduction: 0,
        dashainBonus: 0,
        isMarried: s.isMarried,
        otherDeductions: 0,
        totalDeductions: 0,
        netSalary: 0,
      };
    }

    const daysAbsent = Math.max(0, workingDaysInMonth - effectivePresent);
    const totalAllowances = dearnessAllowance + transportAllowance + medicalAllowance + otherAllowances;

    const MONTHLY_DIVISOR = 30;
    const dailyRate = Math.round((basicSalary / MONTHLY_DIVISOR) * 100) / 100;
    const absenceDeduction = Math.round(dailyRate * daysAbsent * 100) / 100;

    const overtimePay = Math.round(overtimeHours * overtimeRatePerHour * 100) / 100;
    const grossSalary = Math.round((basicSalary + totalAllowances + overtimePay - absenceDeduction) * 100) / 100;

    const effectiveBasic = Math.max(0, Math.round((basicSalary - absenceDeduction) * 100) / 100);
    const hasEffectiveEarnings = grossSalary > 0;

    // Effective deduction flags: org-level availability AND per-employee opt-in.
    // The SSF effective flag also drives the Nepal TDS first-slab waiver
    // (Section 21(4) of the Financial Act), so it must be computed once and
    // reused — passing s.ssfEnabled raw would over-grant the waiver to
    // employees whose org has SSF disabled.
    const effectiveSsf = orgAvailability.ssf && !!s.ssfEnabled;
    const effectivePf  = orgAvailability.pf  && !!s.pfEnabled;
    const effectiveCit = orgAvailability.cit && !!s.citEnabled;
    const effectiveTds = orgAvailability.tds && !!s.tdsEnabled;

    let employeeSsf = 0;
    let employerSsf = 0;
    if (effectiveSsf && hasEffectiveEarnings) {
      employeeSsf = Math.round(effectiveBasic * (employeeSsfRate / 100) * 100) / 100;
      employerSsf = Math.round(effectiveBasic * (employerSsfRate / 100) * 100) / 100;
    }

    let employeePf = 0;
    let employerPf = 0;
    if (effectivePf && hasEffectiveEarnings) {
      const pfEmployeeRate = toNum(s.employeePfRate);
      const pfEmployerRate = toNum(s.employerPfRate);
      employeePf = Math.round(effectiveBasic * (pfEmployeeRate / 100) * 100) / 100;
      employerPf = Math.round(effectiveBasic * (pfEmployerRate / 100) * 100) / 100;
    }

    const citDeduction = (effectiveCit && hasEffectiveEarnings) ? toNum(s.citAmount) : 0;
    const advanceDeduct = hasEffectiveEarnings ? toNum(s.advanceDeduction) : 0;

    const empDashainOverride = s.dashainBonusPercent;
    const effectiveDashainPercent = (empDashainOverride !== null && empDashainOverride !== undefined) ? toNum(empDashainOverride) : dashainBonusPercent;
    const dashainBonus = bsMonth === dashainBonusMonth ? Math.round(basicSalary * (effectiveDashainPercent / 100) * 100) / 100 : 0;

    let tds = 0;
    if (effectiveTds && hasEffectiveEarnings) {
      const annualTaxable = (grossSalary + dashainBonus - employeeSsf - employeePf - citDeduction) * 12;
      tds = calculateNepalTDS(annualTaxable, s.isMarried, tdsConfig, effectiveSsf);
    }

    const rawTotalDeductions = Math.round((employeeSsf + employeePf + citDeduction + advanceDeduct + tds) * 100) / 100;
    const totalDeductions = Math.min(rawTotalDeductions, grossSalary + dashainBonus);
    const netSalary = Math.max(0, Math.round((grossSalary + dashainBonus - totalDeductions) * 100) / 100);

    return {
      membershipId: membership.id,
      organizationId,
      year: adYear,
      month: adMonth,
      bsYear,
      bsMonth,
      workingDaysInMonth,
      holidaysInMonth,
      daysPresent: effectivePresent,
      daysAbsent,
      paidLeaveDays,
      unpaidLeaveDays,
      overtimeHours,
      basicSalary,
      dearnessAllowance,
      transportAllowance,
      medicalAllowance,
      otherAllowances,
      overtimePay,
      grossSalary,
      absenceDeduction,
      employeeSsf,
      employerSsf,
      tds,
      employeePf,
      employerPf,
      citDeduction,
      advanceDeduction: advanceDeduct,
      dashainBonus,
      isMarried: s.isMarried,
      otherDeductions: 0,
      totalDeductions,
      netSalary,
    };
  }

  // ======== Generate payroll ========

  async generatePayroll(input: GeneratePayrollInput, currentUser: JWTPayload) {
    const { bsYear, bsMonth } = input;

    const organizationId = input.organizationId || currentUser.organizationId;
    if (!organizationId) {
      throw new ValidationError('organizationId is required for payroll generation');
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization not found');

    const orgDashainMonth = org.dashainBonusMonth ?? 6;
    const orgDashainPercent = org.dashainBonusPercent ?? 100;
    const orgAvailability = {
      ssf: org.ssfEnabled,
      pf:  org.pfEnabled,
      cit: org.citEnabled,
      tds: org.tdsEnabled,
    };

    if (currentUser.role !== 'SUPER_ADMIN' && organizationId !== currentUser.organizationId) {
      throw new ValidationError('Access denied to this organization');
    }

    const { start: adStart, end: adEnd } = getBSMonthADRange(bsYear, bsMonth);
    const holidayDates = await holidayService.getHolidayDatesForMonth(bsYear, bsMonth, organizationId);
    const holidaysInMonth = holidayDates.length;
    const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
    const workingDaysInMonth = getEffectiveWorkingDays(bsYear, bsMonth, holidayDates, org.workingDays);

    let tdsConfig: any = null;
    try {
      const dbConfig = await prisma.systemConfig.findFirst({
        where: { key: 'tds_slabs' },
        orderBy: { updatedAt: 'desc' },
      });
      if (dbConfig) tdsConfig = JSON.parse(dbConfig.value);
    } catch (e) { /* fall back to defaults */ }

    // Branch-scope: when a BRANCH_ADMIN triggers generation, only generate
    // payroll for employees in their own branch. ORG_ADMIN generates org-wide.
    const scope = getBranchScope(currentUser);
    const memberships = await prisma.orgMembership.findMany({
      where: {
        isActive: true,
        leftAt: null,
        role: 'EMPLOYEE',
        organizationId,
        paySettings: { isNot: null },
        ...branchWhere(scope),
      },
      include: {
        paySettings: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (memberships.length === 0) {
      throw new ValidationError('No employees with pay settings configured');
    }

    const payrollRecords = [];

    for (const membership of memberships) {
      // Point 3: look up per-employee overtime override by membershipId
      const overtimeOverride = input.overtimeOverrides?.[membership.id];

      // Per-employee working days: use employee override if set, else org default
      const resolvedForEmployee = await rosterService.resolveScheduleForPayroll(membership.id, organizationId, adStart);
      const employeeWorkingDays = getEffectiveWorkingDays(bsYear, bsMonth, holidayDates, resolvedForEmployee.workingDays.join(','));

      const payrollData = await this.calculateEmployeePayroll(
        membership, organizationId, bsYear, bsMonth,
        adStart, adEnd, employeeWorkingDays, holidaysInMonth, tdsConfig,
        orgAvailability,
        overtimeOverride,
        orgDashainMonth,
        orgDashainPercent
      );

      if (payrollData.daysPresent === 0 && payrollData.overtimeHours === 0) {
        log.info({ membershipId: membership.id, bsYear, bsMonth }, 'Skipping payroll — zero attendance');
        continue;
      }

      const record = await prisma.$transaction(async (tx) => {
        const existing = await tx.payrollRecord.findUnique({
          where: { membershipId_bsYear_bsMonth: { membershipId: membership.id, bsYear, bsMonth } },
          select: { status: true, netSalary: true },
        });

        // Guard: PAID records can only be overridden by ORG_ADMIN with a reason
        if (existing?.status === 'PAID') {
          if (currentUser.role === 'ORG_ACCOUNTANT') {
            throw new ValidationError(
              'Accountants cannot regenerate a payroll month that has already been paid. Contact the organization admin.',
              'PAYROLL_LOCKED'
            );
          }
          if (!input.reason || input.reason.trim().split(/\s+/).length < 10) {
            throw new ValidationError(
              'A reason of at least 10 words is required to regenerate a paid payroll month.',
              'REASON_REQUIRED'
            );
          }
        }

        const isPaidOverride = existing?.status === 'PAID';
        const netChanged = isPaidOverride &&
          Math.abs(toNum(existing.netSalary) - payrollData.netSalary) > 0.01;
        const overrideFields = netChanged ? {
          regeneratedFromPaid: true,
          regeneratedAt: new Date(),
          regeneratedBy: currentUser.userId,
          previousNetSalary: existing.netSalary,
          overrideReason: input.reason!.trim(),
        } : isPaidOverride ? {
          regeneratedFromPaid: false,
          regeneratedAt: null,
          regeneratedBy: null,
          previousNetSalary: null,
          overrideReason: null,
        } : {};

        const result = await tx.payrollRecord.upsert({
          where: { membershipId_bsYear_bsMonth: { membershipId: membership.id, bsYear, bsMonth } },
          update: { ...payrollData, status: 'DRAFT', ...overrideFields },
          create: { ...payrollData, status: 'DRAFT' },
          include: PAYROLL_RECORD_INCLUDE,
        });

        return { result, previousStatus: existing?.status, previousNetSalary: existing?.netSalary };
      });

      this.logPayrollAudit({
        organizationId,
        payrollRecordId: record.result.id,
        employeeUserId: membership.user.id,
        action: record.previousStatus === 'PAID' ? 'REGENERATED' : 'GENERATED',
        fromStatus: record.previousStatus,
        toStatus: 'DRAFT',
        triggeredBy: currentUser.userId,
        bsYear,
        bsMonth,
        reason: record.previousStatus === 'PAID'
          ? `PAID OVERRIDE — Previous net: Rs.${toNum(record.previousNetSalary).toLocaleString()} — Reason: ${input.reason!.trim()}`
          : overtimeOverride !== undefined
            ? `Overtime override applied: ${overtimeOverride}h (calculated was ${payrollData.overtimeHours}h)`
            : undefined,
      });

      payrollRecords.push(this.mapPayrollRecord(flattenRecordUser(record.result)));
    }

    log.info({ bsYear, bsMonth, orgId: organizationId, count: payrollRecords.length }, 'Payroll generated');

    return {
      bsYear,
      bsMonth,
      monthNameEn: BS_MONTHS_EN[bsMonth - 1],
      monthNameNp: BS_MONTHS_NP[bsMonth - 1],
      daysInMonth,
      workingDaysInMonth,
      holidaysInMonth,
      records: payrollRecords,
    };
  }

  // ======== Regenerate for single employee ========

  async regenerateForEmployee(
    userId: string,
    bsYear: number,
    bsMonth: number,
    reason: string,
    currentUser: JWTPayload
  ) {
    const organizationId = currentUser.organizationId;
    if (!organizationId) {
      throw new ValidationError('Organization context required');
    }

    // Branch-scope: BRANCH_ADMIN can only regenerate payroll for employees
    // in their own branch. Out-of-branch returns NotFoundError.
    const scope = getBranchScope(currentUser);
    const membership = await prisma.orgMembership.findFirst({
      where: { userId, organizationId, isActive: true, role: 'EMPLOYEE', ...branchWhere(scope) },
      include: { paySettings: true, user: { select: { id: true } } },
    });

    if (!membership) throw new NotFoundError('Employee not found');
    if (!membership.paySettings) throw new ValidationError('Employee has no pay settings configured');

    const existing = await prisma.payrollRecord.findUnique({
      where: { membershipId_bsYear_bsMonth: { membershipId: membership.id, bsYear, bsMonth } },
      select: { id: true, status: true },
    });

    if (existing && (existing.status === 'APPROVED' || existing.status === 'PAID')) {
      throw new ValidationError(
        `Cannot regenerate a payslip with status ${existing.status}. Void it first.`,
        'PAYROLL_LOCKED'
      );
    }

    const { start: adStart, end: adEnd } = getBSMonthADRange(bsYear, bsMonth);
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization not found');

    const orgDashainMonth = org.dashainBonusMonth ?? 6;
    const orgDashainPercent = org.dashainBonusPercent ?? 100;
    const orgAvailability = {
      ssf: org.ssfEnabled,
      pf:  org.pfEnabled,
      cit: org.citEnabled,
      tds: org.tdsEnabled,
    };

    const holidayDates = await holidayService.getHolidayDatesForMonth(bsYear, bsMonth, organizationId);
    const holidaysInMonth = holidayDates.length;
    const resolvedForEmployee = await rosterService.resolveScheduleForPayroll(membership.id, organizationId, adStart);
    const workingDaysInMonth = getEffectiveWorkingDays(bsYear, bsMonth, holidayDates, resolvedForEmployee.workingDays.join(','));

    let tdsConfig: any = null;
    try {
      const dbConfig = await prisma.systemConfig.findFirst({
        where: { key: 'tds_slabs' },
        orderBy: { updatedAt: 'desc' },
      });
      if (dbConfig) tdsConfig = JSON.parse(dbConfig.value);
    } catch (e) { /* fall back to defaults */ }

    const payrollData = await this.calculateEmployeePayroll(
      membership, organizationId, bsYear, bsMonth,
      adStart, adEnd, workingDaysInMonth, holidaysInMonth, tdsConfig,
      orgAvailability,
      undefined, // No override for single-employee regeneration
      orgDashainMonth,
      orgDashainPercent
    );
    const record = await prisma.$transaction(async (tx) => {
      return tx.payrollRecord.upsert({
        where: { membershipId_bsYear_bsMonth: { membershipId: membership.id, bsYear, bsMonth } },
        update: { ...payrollData, status: 'DRAFT' },
        create: { ...payrollData, status: 'DRAFT' },
        include: PAYROLL_RECORD_INCLUDE,
      });
    });

    await this.logPayrollAudit({
      organizationId,
      payrollRecordId: record.id,
      employeeUserId: userId,
      action: 'REGENERATED',
      fromStatus: existing?.status,
      toStatus: 'DRAFT',
      triggeredBy: currentUser.userId,
      reason,
      bsYear,
      bsMonth,
    });

    log.info({
      membershipId: membership.id, bsYear, bsMonth, orgId: organizationId, reason
    }, 'Payroll regenerated for single employee');

    return this.mapPayrollRecord(flattenRecordUser(record));
  }

  // ======== Get records ========

  async getRecords(bsYear: number, bsMonth: number, currentUser: JWTPayload, branchIdFilter?: string) {
    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const where: Record<string, unknown> = { bsYear, bsMonth };
    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }
    // PayrollRecord has no direct branchId — filter via membership relation.
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }
    const records = await prisma.payrollRecord.findMany({
      where,
      include: PAYROLL_RECORD_INCLUDE,
      orderBy: { membership: { user: { firstName: 'asc' } } },
    });
    // Resolve regeneratedBy userIds to names
    const regeneratedByIds = [...new Set(
      records.filter(r => r.regeneratedBy).map(r => r.regeneratedBy as string)
    )];
    const regeneratedByUsers = regeneratedByIds.length > 0
      ? await prisma.user.findMany({
        where: { id: { in: regeneratedByIds } },
        select: { id: true, firstName: true, lastName: true },
      })
      : [];
    const regeneratedByMap = Object.fromEntries(
      regeneratedByUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`])
    );

    const mapped = records.map(r => {
      const base = this.mapPayrollRecord(flattenRecordUser(r));
      if (base.regeneratedBy) {
        base.regeneratedBy = regeneratedByMap[base.regeneratedBy] ?? base.regeneratedBy;
      }
      return base;
    });
    const summary = {
      totalEmployees: mapped.length,
      totalGross: mapped.reduce((sum, r) => sum + r.grossSalary, 0),
      totalDeductions: mapped.reduce((sum, r) => sum + r.totalDeductions, 0),
      totalNet: mapped.reduce((sum, r) => sum + r.netSalary, 0),
      totalEmployerSsf: mapped.reduce((sum, r) => sum + r.employerSsf, 0),
      totalEmployeeSsf: mapped.reduce((sum, r) => sum + r.employeeSsf, 0),
      totalTDS: mapped.reduce((sum, r) => sum + r.tds, 0),
      needsRecalculation: mapped.filter(r => r.status === 'NEEDS_RECALCULATION').length,
    };
    return { records: mapped, summary };
  }
  async getAuditLog(payrollRecordId: string, currentUser: JWTPayload) {
    const scope = getBranchScope(currentUser);
    const record = await prisma.payrollRecord.findFirst({
      where: {
        id: payrollRecordId,
        ...(currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId ? { organizationId: currentUser.organizationId } : {}),
        ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
      },
    });
    if (!record) throw new NotFoundError('Payroll record not found');

    const logs = await prisma.payrollAuditLog.findMany({
      where: { payrollRecordId },
      orderBy: { createdAt: 'desc' },
    });

    // Resolve triggeredBy userIds to names
    const userIds = [...new Set(logs.map(l => l.triggeredBy).filter(Boolean))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    return logs.map(l => ({
      ...l,
      triggeredByName: userMap[l.triggeredBy] ?? l.triggeredBy,
    }));
  }

  // ======== Status updates ========

  async updateStatus(recordId: string, status: string, currentUser: JWTPayload) {
    const updateData: Record<string, unknown> = { status };
    if (status === 'PROCESSED') updateData.processedAt = new Date();
    if (status === 'APPROVED') updateData.approvedAt = new Date();
    if (status === 'PAID') updateData.paidAt = new Date();

    const scope = getBranchScope(currentUser);
    const where: Record<string, unknown> = { id: recordId };
    if (currentUser.role !== 'SUPER_ADMIN') {
      if (!currentUser.organizationId) throw new ValidationError('No organization assigned');
      where.organizationId = currentUser.organizationId;
    }
    // Branch-scope: BRANCH_ADMIN can only update records for employees in
    // their own branch (no direct branchId on PayrollRecord → use membership).
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }

    // Read → validate → write happen in a single Serializable transaction
    // so concurrent clicks can't both pass the same validation and both
    // write (race would otherwise allow two admins to each flip
    // PROCESSED→APPROVED, producing stale audit entries and, worse,
    // interleaved transitions like APPROVED→PROCESSED racing with
    // APPROVED→PAID leaving a PAID record with no approval chain).
    const { updated, fromStatus, fromOrganizationId, membershipUserId } =
      await runSerializable(async (tx) => {
        const record = await tx.payrollRecord.findFirst({
          where,
          include: { membership: { select: { userId: true } } },
        });
        if (!record) throw new NotFoundError('Payroll record not found');

        if (record.status === 'NEEDS_RECALCULATION' && status !== 'NEEDS_RECALCULATION') {
          throw new ValidationError(
            'This payslip has attendance corrections and must be regenerated before changing status.',
            'NEEDS_RECALCULATION'
          );
        }

        if (record.status === 'PAID') {
          throw new ValidationError(
            'Paid payroll records cannot be modified. Corrections must be applied in the next payroll period.'
          );
        }

        const ROLE_TRANSITIONS: Record<string, Record<string, string[]>> = {
          ORG_ACCOUNTANT: {
            DRAFT: ['PROCESSED'],
            APPROVED: ['PAID'],
          },
          ORG_ADMIN: {
            DRAFT: ['PROCESSED'],
            PROCESSED: ['APPROVED'],
            APPROVED: ['PROCESSED', 'PAID'],
          },
          // Branch admins have the same status-change powers as org admins,
          // but scoped to their own branch via the `where.membership.branchId`
          // filter applied above.
          BRANCH_ADMIN: {
            DRAFT: ['PROCESSED'],
            PROCESSED: ['APPROVED'],
            APPROVED: ['PROCESSED', 'PAID'],
          },
          SUPER_ADMIN: {
            DRAFT: ['PROCESSED'],
            PROCESSED: ['APPROVED'],
            APPROVED: ['PROCESSED', 'PAID'],
          },
        };

        const transitions = ROLE_TRANSITIONS[currentUser.role];
        if (!transitions) {
          throw new ValidationError('Your role does not have permission to change payroll status.');
        }
        const allowed = transitions[record.status] || [];
        if (!allowed.includes(status)) {
          throw new ValidationError(
            `${currentUser.role} cannot change status from ${record.status} to ${status}.`
          );
        }

        // Defense-in-depth: condition the update on the status we just
        // read. Even under Serializable, this makes the write's intent
        // explicit and guards against any non-transactional helpers.
        const updatedRec = await tx.payrollRecord.update({
          where: { id: recordId },
          data: updateData,
          include: PAYROLL_RECORD_INCLUDE,
        });

        return {
          updated: updatedRec,
          fromStatus: record.status,
          fromOrganizationId: record.organizationId,
          membershipUserId: (record as any).membership?.userId,
        };
      }, { op: 'updateStatus' });

    // Audit log outside the transaction — matches clockAction's pattern
    // of keeping the audit path tolerant of its own failures. If audit
    // write fails we still want the status change to have committed.
    await this.logPayrollAudit({
      organizationId: fromOrganizationId,
      payrollRecordId: recordId,
      employeeUserId: membershipUserId,
      action: 'STATUS_CHANGED',
      fromStatus,
      toStatus: status,
      triggeredBy: currentUser.userId,
      bsYear: updated.bsYear,
      bsMonth: updated.bsMonth,
    });

    return flattenRecordUser(updated);
  }

  async bulkUpdateStatus(bsYear: number, bsMonth: number, status: string, currentUser: JWTPayload) {
    const scope = getBranchScope(currentUser);
    const where: Record<string, unknown> = { bsYear, bsMonth };
    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }
    // Branch-scope: bulk update only touches records for BRANCH_ADMIN's
    // own branch employees. ORG_ADMIN sees and updates org-wide.
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }

    // Role permission check: pure JWT logic, no DB access needed — keep
    // outside the transaction so we fail fast on unauthorized callers.
    const BULK_ROLE_TRANSITIONS: Record<string, string[]> = {
      ORG_ACCOUNTANT: ['PROCESSED', 'PAID'],
      ORG_ADMIN: ['PROCESSED', 'APPROVED', 'PAID'],
      BRANCH_ADMIN: ['PROCESSED', 'APPROVED', 'PAID'],
      SUPER_ADMIN: ['PROCESSED', 'APPROVED', 'PAID'],
    };
    const allowedStatuses = BULK_ROLE_TRANSITIONS[currentUser.role];
    if (!allowedStatuses || !allowedStatuses.includes(status)) {
      throw new ValidationError(
        `${currentUser.role} cannot bulk update payroll to ${status}.`
      );
    }

    const BULK_FROM_STATES: Record<string, string[]> = {
      PROCESSED: ['DRAFT', 'NEEDS_RECALCULATION'],
      APPROVED: ['PROCESSED'],
      PAID: ['APPROVED'],
    };
    const validFromStates = BULK_FROM_STATES[status];

    // All the DB work happens in one Serializable transaction:
    //   1. NEEDS_RECALCULATION precheck (for APPROVED/PAID transitions)
    //   2. Load records to audit
    //   3. Validate transitions against current status
    //   4. Conditional updateMany — only rows whose status is still
    //      in validFromStates actually flip, so a race that changed
    //      a record's status between step 2 and step 4 is safely
    //      excluded instead of silently overwritten.
    const { records } = await runSerializable(async (tx) => {
      if (status === 'APPROVED' || status === 'PAID') {
        const blockedCount = await tx.payrollRecord.count({
          where: { ...where, status: 'NEEDS_RECALCULATION' },
        });
        if (blockedCount > 0) {
          throw new ValidationError(
            `${blockedCount} employee(s) have attendance corrections and must be regenerated before bulk ${status.toLowerCase()}.`,
            'NEEDS_RECALCULATION'
          );
        }
      }

      const records = await tx.payrollRecord.findMany({
        where,
        select: {
          id: true,
          status: true,
          membershipId: true,
          organizationId: true,
          membership: { select: { userId: true } },
        },
      });

      if (validFromStates) {
        const invalidRecords = records.filter((r) => !validFromStates.includes(r.status));
        if (invalidRecords.length > 0) {
          const invalidStatuses = [...new Set(invalidRecords.map((r) => r.status))].join(', ');
          throw new ValidationError(
            `Cannot bulk update to ${status}: ${invalidRecords.length} record(s) are in invalid states (${invalidStatuses}). All records must be ${validFromStates.join(' or ')} before moving to ${status}.`,
            'INVALID_TRANSITION'
          );
        }
      }

      const updateData: Record<string, unknown> = { status };
      if (status === 'PROCESSED') updateData.processedAt = new Date();
      if (status === 'APPROVED') updateData.approvedAt = new Date();
      if (status === 'PAID') updateData.paidAt = new Date();

      // Conditional updateMany — limits the write to records still in
      // a valid source state. Under Serializable this is belt-and-braces
      // (the findMany above already saw each record), but the filter
      // makes the intent explicit and survives any future refactor that
      // might weaken the isolation.
      const writeWhere = validFromStates
        ? { ...where, status: { in: validFromStates } }
        : where;
      await tx.payrollRecord.updateMany({ where: writeWhere, data: updateData });

      return { records };
    }, { op: 'bulkUpdateStatus' });

    // Audit writes and emails run outside the transaction. They can
    // fail independently without rolling back the status change, which
    // matches the single-record updateStatus path.
    //
    // Fix: previous impl missed `await` on Promise.all, so audit writes
    // were fire-and-forget. Now we await so failures are logged before
    // the request returns.
    try {
      await Promise.all(
        records.map((r) =>
          this.logPayrollAudit({
            organizationId: r.organizationId,
            payrollRecordId: r.id,
            employeeUserId: r.membership?.userId,
            action: 'STATUS_CHANGED',
            fromStatus: r.status,
            toStatus: status,
            triggeredBy: currentUser.userId,
            bsYear,
            bsMonth,
          })
        )
      );
    } catch (err) {
      log.error({ err }, 'Failed to write bulk payroll audit logs');
    }

    if (status === 'APPROVED') {
      try {
        const fullRecords = await prisma.payrollRecord.findMany({
          where,
          include: {
            membership: {
              select: {
                user: { select: { email: true, firstName: true } },
              },
            },
            organization: { select: { name: true } },
          },
        });
        const toNumLocal = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
        emailService.sendPayrollBulkNotification(
          fullRecords.map(r => ({
            email: r.membership.user.email,
            firstName: r.membership.user.firstName,
            netSalary: toNumLocal(r.netSalary),
            bsMonth: BS_MONTHS_EN[(r.bsMonth || 1) - 1],
            bsYear: r.bsYear,
            orgName: r.organization.name,
          }))
        ).catch(err => log.error({ err }, 'Failed to send payroll emails'));
      } catch (err) { log.error({ err }, 'Failed to notify employees of payroll'); }
    }

    return { message: `All records updated to ${status}` };
  }

  // ======== Flag payroll needs recalculation ========

  async flagPayrollNeedsRecalculation(
    membershipId: string,
    organizationId: string,
    bsYear: number,
    bsMonth: number,
    triggeredBy: string,
    attendanceRecordId?: string,
    reason?: string
  ): Promise<{ flagged: boolean; previousStatus?: string }> {
    const existing = await prisma.payrollRecord.findUnique({
      where: { membershipId_bsYear_bsMonth: { membershipId, bsYear, bsMonth } },
      select: { id: true, status: true, membership: { select: { userId: true } } },
    });

    if (!existing) return { flagged: false };
    if (existing.status === 'DRAFT') return { flagged: false };
    if (existing.status === 'NEEDS_RECALCULATION') return { flagged: true, previousStatus: existing.status };

    await prisma.payrollRecord.update({
      where: { id: existing.id },
      data: { status: 'NEEDS_RECALCULATION' },
    });

    await this.logPayrollAudit({
      organizationId,
      payrollRecordId: existing.id,
      employeeUserId: (existing as any).membership?.userId,
      action: 'FLAGGED_NEEDS_RECALCULATION',
      fromStatus: existing.status,
      toStatus: 'NEEDS_RECALCULATION',
      triggeredBy,
      attendanceRecordId,
      reason: reason ?? 'Attendance record corrected after payroll was generated',
      bsYear,
      bsMonth,
    });

    log.warn({ membershipId, bsYear, bsMonth, previousStatus: existing.status }, 'Payroll flagged NEEDS_RECALCULATION');

    return { flagged: true, previousStatus: existing.status };
  }

  // ======== Multi-month ========

  async getMultiMonthData(fromBsYear: number, fromBsMonth: number, toBsYear: number, toBsMonth: number, currentUser: JWTPayload, branchIdFilter?: string) {
    const months: Array<{ bsYear: number; bsMonth: number }> = [];
    let currentYear = fromBsYear;
    let currentMonth = fromBsMonth;
    while (currentYear < toBsYear || (currentYear === toBsYear && currentMonth <= toBsMonth)) {
      months.push({ bsYear: currentYear, bsMonth: currentMonth });
      currentMonth++;
      if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    }
    if (months.length > 12) throw new ValidationError('Maximum 12 months allowed');

    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const where: Record<string, unknown> = {
      OR: months.map((m) => ({ bsYear: m.bsYear, bsMonth: m.bsMonth })),
    };
    if (currentUser.role === 'EMPLOYEE') {
      where.membershipId = currentUser.membershipId;
    } else if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }
    // Branch-scope: BRANCH_ADMIN sees multi-month data only for their branch.
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }

    const records = await prisma.payrollRecord.findMany({
      where,
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: [{ membership: { user: { firstName: 'asc' } } }, { bsYear: 'asc' }, { bsMonth: 'asc' }],
    });

    const employeeMap: Record<string, any> = {};
    for (const record of records) {
      const membershipId = record.membershipId;
      if (!employeeMap[membershipId]) {
        employeeMap[membershipId] = {
          userId: record.membership.user.id,
          membershipId,
          employee: {
            firstName: record.membership.user.firstName,
            lastName: record.membership.user.lastName,
            employeeId: record.membership.employeeId,
            email: record.membership.user.email,
          },
          months: {},
          totals: {
            basicSalary: 0, grossSalary: 0, totalDeductions: 0,
            netSalary: 0, employeeSsf: 0, employeePf: 0, tds: 0, monthsProcessed: 0,
          },
        };
      }
      const emp = employeeMap[membershipId];
      const monthKey = `${record.bsYear}-${record.bsMonth}`;
      emp.months[monthKey] = {
        id: record.id,
        bsYear: record.bsYear, bsMonth: record.bsMonth,
        monthNameEn: BS_MONTHS_EN[record.bsMonth - 1],
        monthNameNp: BS_MONTHS_NP[record.bsMonth - 1],
        basicSalary: toNum(record.basicSalary),
        dearnessAllowance: toNum(record.dearnessAllowance),
        transportAllowance: toNum(record.transportAllowance),
        medicalAllowance: toNum(record.medicalAllowance),
        otherAllowances: toNum(record.otherAllowances),
        grossSalary: toNum(record.grossSalary),
        absenceDeduction: toNum(record.absenceDeduction),
        employeeSsf: toNum(record.employeeSsf),
        employeePf: toNum(record.employeePf),
        citDeduction: toNum(record.citDeduction),
        tds: toNum(record.tds),
        advanceDeduction: toNum(record.advanceDeduction),
        dashainBonus: toNum(record.dashainBonus),
        totalDeductions: toNum(record.totalDeductions),
        netSalary: toNum(record.netSalary),
        status: record.status,
        workingDaysInMonth: record.workingDaysInMonth,
        daysPresent: record.daysPresent,
        daysAbsent: record.daysAbsent,
      };
      emp.totals.basicSalary += toNum(record.basicSalary);
      emp.totals.grossSalary += toNum(record.grossSalary);
      emp.totals.totalDeductions += toNum(record.totalDeductions);
      emp.totals.netSalary += toNum(record.netSalary);
      emp.totals.employeeSsf += toNum(record.employeeSsf);
      emp.totals.employeePf += toNum(record.employeePf);
      emp.totals.tds += toNum(record.tds);
      emp.totals.monthsProcessed++;
    }

    const employees = Object.values(employeeMap).map((emp: any) => ({
      ...emp,
      totals: {
        basicSalary: Math.round(emp.totals.basicSalary * 100) / 100,
        grossSalary: Math.round(emp.totals.grossSalary * 100) / 100,
        totalDeductions: Math.round(emp.totals.totalDeductions * 100) / 100,
        netSalary: Math.round(emp.totals.netSalary * 100) / 100,
        employeeSsf: Math.round(emp.totals.employeeSsf * 100) / 100,
        employeePf: Math.round(emp.totals.employeePf * 100) / 100,
        tds: Math.round(emp.totals.tds * 100) / 100,
        monthsProcessed: emp.totals.monthsProcessed,
      },
    }));

    const grandTotals = { basicSalary: 0, grossSalary: 0, totalDeductions: 0, netSalary: 0, employeeSsf: 0, employeePf: 0, tds: 0 };
    for (const emp of employees) {
      grandTotals.basicSalary += emp.totals.basicSalary;
      grandTotals.grossSalary += emp.totals.grossSalary;
      grandTotals.totalDeductions += emp.totals.totalDeductions;
      grandTotals.netSalary += emp.totals.netSalary;
      grandTotals.employeeSsf += emp.totals.employeeSsf;
      grandTotals.employeePf += emp.totals.employeePf;
      grandTotals.tds += emp.totals.tds;
    }

    return {
      months,
      employees,
      grandTotals: {
        basicSalary: Math.round(grandTotals.basicSalary * 100) / 100,
        grossSalary: Math.round(grandTotals.grossSalary * 100) / 100,
        totalDeductions: Math.round(grandTotals.totalDeductions * 100) / 100,
        netSalary: Math.round(grandTotals.netSalary * 100) / 100,
        employeeSsf: Math.round(grandTotals.employeeSsf * 100) / 100,
        employeePf: Math.round(grandTotals.employeePf * 100) / 100,
        tds: Math.round(grandTotals.tds * 100) / 100,
      },
    };
  }

  async getEarliestBsYear(currentUser: JWTPayload, branchIdFilter?: string): Promise<number | null> {
    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const where: Record<string, unknown> = {};
    if (currentUser.role === 'EMPLOYEE') {
      where.membershipId = currentUser.membershipId;
    } else if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }
    // Branch-scope: BRANCH_ADMIN's earliest record reflects their branch only.
    if (scope.branchId) {
      where.membership = { branchId: scope.branchId };
    }
    const record = await prisma.payrollRecord.findFirst({
      where,
      orderBy: [{ bsYear: 'asc' }, { bsMonth: 'asc' }],
      select: { bsYear: true },
    });
    return record ? record.bsYear : null;
  }

  // ======== Private helpers ========

  private async getApprovedLeaves(membershipId: string, adStart: Date, adEnd: Date) {
    const leaves = await prisma.leave.findMany({
      where: {
        membershipId,
        status: 'APPROVED',
        startDate: { lte: adEnd },
        endDate: { gte: adStart },
      },
    });
    let paidDays = 0;
    let unpaidDays = 0;
    for (const leave of leaves) {
      const start = new Date(Math.max(leave.startDate.getTime(), adStart.getTime()));
      const end = new Date(Math.min(leave.endDate.getTime(), adEnd.getTime()));
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (leave.type === 'UNPAID') { unpaidDays += days; } else { paidDays += days; }
    }
    return { paidDays, unpaidDays };
  }
  /**
     * Grace periods applied independently:
     * - earlyClockInGrace: only deducted from minutes worked before workStartTime
     * - lateClockOutGrace: only deducted from minutes worked after workEndTime
     * 
     * Example (grace: 15 early, 30 late, shift: 10:00-18:00):
     *   Clock in 9:50, clock out 18:40 → 10 min early (within 15 grace) + 40 min late (30 grace applied) = 10 min OT
     *   Clock in 10:00, clock out 19:00 → 0 early + 60 min late - 30 grace = 30 min OT
     *   Clock in 10:00, clock out 18:25 → 0 early + 25 min late (within 30 grace) = 0 OT
     */
  private async getDaysPresent(membershipId: string, adStart: Date, adEnd: Date) {
    const membership = await prisma.orgMembership.findUnique({
      where: { id: membershipId },
      select: {
        organizationId: true,
        shiftStartTime: true,
        shiftEndTime: true,
        workingDays: true,
        organization: {
          select: {
            earlyClockInGraceMinutes: true,
            lateClockOutGraceMinutes: true,
            workStartTime: true,
            workEndTime: true,
          },
        },
      },
    });

    const earlyGrace = membership?.organization?.earlyClockInGraceMinutes ?? 0;
    const lateGrace = membership?.organization?.lateClockOutGraceMinutes ?? 0;

    // Pre-fetch all applicable roster schedules in one query — resolved per record date below
    const rosterSchedules = membership?.organizationId
      ? await prisma.rosterSchedule.findMany({
          where: {
            organizationId: membership.organizationId,
            deletedAt: null,
            OR: [{ membershipId }, { membershipId: null }],
          },
          select: {
            membershipId: true,
            daySchedules: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        })
      : [];

    const records = await prisma.attendanceRecord.findMany({
      where: {
        membershipId,
        checkInTime: { gte: adStart, lte: adEnd },
        status: { in: ['CHECKED_OUT', 'AUTO_CLOSED'] },
      },
    });

    const uniqueDays = new Set<string>();
    let totalMinutes = 0;
    let totalOvertimeMinutes = 0;

    for (const r of records) {
      uniqueDays.add(r.checkInTime.toISOString().split('T')[0]);
      if (r.duration) totalMinutes += r.duration;

      if (r.checkOutTime && r.duration) {
        const checkIn = r.checkInTime;
        const checkOut = r.checkOutTime;

        // Resolve shift times for this specific attendance date using 4-level priority (in-memory)
        const recDate = r.checkInTime;
        const dayOfWeek = recDate.getDay();
        const empSched = rosterSchedules.find(
          (s) => s.membershipId === membershipId && recDate >= s.effectiveFrom && (s.effectiveTo === null || recDate <= s.effectiveTo),
        );
        const orgSched = !empSched ? rosterSchedules.find(
          (s) => s.membershipId === null && recDate >= s.effectiveFrom && (s.effectiveTo === null || recDate <= s.effectiveTo),
        ) : undefined;

        // Parse daySchedules from whichever roster level matched
        const rosterDayMap = empSched
          ? parseDaySchedules(empSched.daySchedules)
          : orgSched
            ? parseDaySchedules(orgSched.daySchedules)
            : null;

        // Look up the entry for this specific day of week
        const dayEntry = rosterDayMap?.[dayOfWeek] ?? null;

        // Fall through to Level 3/4 if no roster matched or day not in schedule
        const resolvedStart =
          dayEntry?.start ??
          (membership?.shiftStartTime || undefined) ??
          membership?.organization?.workStartTime ??
          '10:00';
        const resolvedEnd =
          dayEntry?.end ??
          (membership?.shiftEndTime || undefined) ??
          membership?.organization?.workEndTime ??
          '18:00';
        const [startH, startM] = resolvedStart.split(':').map(Number);
        const [endH, endM] = resolvedEnd.split(':').map(Number);

        const dayStart = new Date(checkIn);
        dayStart.setHours(startH, startM, 0, 0);
        const dayEnd = new Date(checkIn);
        dayEnd.setHours(endH, endM, 0, 0);
        // Cross-midnight shift: end time is earlier than start time in minutes
        // so dayEnd belongs to the next calendar day
        if (endH * 60 + endM < startH * 60 + startM) {
          dayEnd.setDate(dayEnd.getDate() + 1);
        }

        const earlyMinutes = Math.max(0, Math.floor((dayStart.getTime() - checkIn.getTime()) / 60000));
        const lateMinutes = Math.max(0, Math.floor((checkOut.getTime() - dayEnd.getTime()) / 60000));

        const earlyOvertime = earlyMinutes > earlyGrace ? earlyMinutes : 0;
        const lateOvertime = lateMinutes > lateGrace ? lateMinutes : 0;
        
        totalOvertimeMinutes += earlyOvertime + lateOvertime;
      }
    }

    const openRecords = await prisma.attendanceRecord.findMany({
      where: { membershipId, checkInTime: { gte: adStart, lte: adEnd }, status: 'CHECKED_IN' },
    });
    for (const r of openRecords) {
      uniqueDays.add(r.checkInTime.toISOString().split('T')[0]);
      totalMinutes += Math.floor((Date.now() - r.checkInTime.getTime()) / 60000);
    }

    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const overtimeHours = Math.round((totalOvertimeMinutes / 60) * 100) / 100;

    return { daysPresent: uniqueDays.size, totalHours, overtimeHours };
  }

  private mapPayrollRecord(r: any) {
    return {
      ...r,
      monthNameEn: BS_MONTHS_EN[(r.bsMonth || 1) - 1],
      monthNameNp: BS_MONTHS_NP[(r.bsMonth || 1) - 1],
      basicSalary: toNum(r.basicSalary),
      dearnessAllowance: toNum(r.dearnessAllowance),
      transportAllowance: toNum(r.transportAllowance),
      medicalAllowance: toNum(r.medicalAllowance),
      otherAllowances: toNum(r.otherAllowances),
      overtimeHours: toNum(r.overtimeHours),
      overtimePay: toNum(r.overtimePay),
      grossSalary: toNum(r.grossSalary),
      absenceDeduction: toNum(r.absenceDeduction),
      employeeSsf: toNum(r.employeeSsf),
      employerSsf: toNum(r.employerSsf),
      employeePf: toNum(r.employeePf),
      employerPf: toNum(r.employerPf),
      citDeduction: toNum(r.citDeduction),
      advanceDeduction: toNum(r.advanceDeduction),
      dashainBonus: toNum(r.dashainBonus),
      isMarried: r.isMarried,
      tds: toNum(r.tds),
      otherDeductions: toNum(r.otherDeductions),
      totalDeductions: toNum(r.totalDeductions),
      netSalary: toNum(r.netSalary),
      regeneratedFromPaid: r.regeneratedFromPaid ?? false,
      regeneratedAt: r.regeneratedAt ?? null,
      regeneratedBy: r.regeneratedBy ?? null,
      previousNetSalary: r.previousNetSalary ? toNum(r.previousNetSalary) : null,
      overrideReason: r.overrideReason ?? null,
    };
  }
}

export const payrollService = new PayrollService();