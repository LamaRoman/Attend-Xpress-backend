import prisma from '../lib/prisma';
import { Router, Response, NextFunction } from 'express';
import { payrollService } from '../services/payroll.service';
import { generatePayslipPDF } from '../services/payslip-pdf.service';
import { validate } from '../middleware/validate';
import {
  paySettingsSchema,
  generatePayrollSchema,
  payrollRecordsQuerySchema,
  payrollStatusSchema,
  bulkPayrollStatusSchema,
} from '../schemas/payroll.schema';
import { authenticate, requireOrgAdmin, requireOrgAdminOrAccountant, enforceOrgIsolation, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/feature.guard';
import { resolveBranchFilter } from '../lib/branch-scope';

const router = Router();

// ===== EMPLOYEE SELF-SERVICE (before orgAdmin middleware) =====
const empRouter = Router();
empRouter.use(authenticate);

// GET /api/payroll/my-payslips — Employee's own payslips
empRouter.get('/my-payslips', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.membershipId) {
      return res.status(400).json({ error: { message: 'No active membership' } });
    }
    const records = await prisma.payrollRecord.findMany({
      where: { membershipId: req.user!.membershipId },
      orderBy: [{ bsYear: 'desc' }, { bsMonth: 'desc' }],
      include: { organization: { select: { name: true } } },
    });
    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
    const mapped = records.map(r => ({
      id: r.id, bsYear: r.bsYear, bsMonth: r.bsMonth, status: r.status,
      workingDaysInMonth: r.workingDaysInMonth, daysPresent: r.daysPresent, daysAbsent: r.daysAbsent,
      basicSalary: toNum(r.basicSalary), grossSalary: toNum(r.grossSalary),
      totalDeductions: toNum(r.totalDeductions), netSalary: toNum(r.netSalary),
      employeeSsf: toNum(r.employeeSsf), employeePf: toNum(r.employeePf),
      tds: toNum(r.tds), dashainBonus: toNum(r.dashainBonus),
      orgName: r.organization.name,
    }));
    res.json({ data: mapped });
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/my-payslip/:recordId/pdf — Download own payslip PDF
empRouter.get('/my-payslip/:recordId/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.membershipId) {
      return res.status(400).json({ error: { message: 'No active membership' } });
    }
    const record = await prisma.payrollRecord.findUnique({
      where: { id: String(req.params.recordId) },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            paySettings: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        organization: { select: { name: true, address: true } },
      },
    });
    if (!record) return res.status(404).json({ error: { message: 'Record not found' } });
    if (record.membershipId !== req.user!.membershipId) return res.status(403).json({ error: { message: 'Access denied' } });

    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
    const ps = record.membership.paySettings;
    const pdfStream = generatePayslipPDF({
      orgName: record.organization.name,
      orgAddress: record.organization.address || undefined,
      employee: {
        firstName: record.membership.user.firstName,
        lastName: record.membership.user.lastName,
        employeeId: record.membership.employeeId || '',
        email: record.membership.user.email || '',
      },
      bsYear: record.bsYear, bsMonth: record.bsMonth,
      workingDaysInMonth: record.workingDaysInMonth, holidaysInMonth: record.holidaysInMonth,
      daysPresent: record.daysPresent, daysAbsent: record.daysAbsent,
      overtimeHours: toNum(record.overtimeHours),
      basicSalary: toNum(record.basicSalary), dearnessAllowance: toNum(record.dearnessAllowance),
      transportAllowance: toNum(record.transportAllowance), medicalAllowance: toNum(record.medicalAllowance),
      otherAllowances: toNum(record.otherAllowances), overtimePay: toNum(record.overtimePay),
      grossSalary: toNum(record.grossSalary), absenceDeduction: toNum(record.absenceDeduction),
      employeeSsf: toNum(record.employeeSsf), employerSsf: toNum(record.employerSsf),
      employeePf: toNum(record.employeePf), employerPf: toNum(record.employerPf),
      citDeduction: toNum(record.citDeduction), advanceDeduction: toNum(record.advanceDeduction),
      dashainBonus: toNum(record.dashainBonus), tds: toNum(record.tds),
      totalDeductions: toNum(record.totalDeductions), netSalary: toNum(record.netSalary),
      isMarried: record.isMarried, status: record.status,
      bankName: ps?.bankName || undefined, bankAccountNumber: ps?.bankAccountNumber || undefined,
    });
    const filename = 'payslip-' + record.membership.employeeId + '-' + record.bsYear + '-' + record.bsMonth + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    pdfStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

empRouter.get('/my-earliest-year', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const earliestBsYear = await payrollService.getEarliestBsYear(req.user!);
    res.json({ data: { earliestBsYear } });
  } catch (error) {
    next(error);
  }
});

empRouter.get('/my-multi-month', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fromBsYear, fromBsMonth, toBsYear, toBsMonth } = req.query;
    if (!fromBsYear || !fromBsMonth || !toBsYear || !toBsMonth) {
      return res.status(400).json({ error: { message: 'fromBsYear, fromBsMonth, toBsYear, toBsMonth are required' } });
    }
    const data = await payrollService.getMultiMonthData(Number(fromBsYear), Number(fromBsMonth), Number(toBsYear), Number(toBsMonth), req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.use(authenticate, requireOrgAdminOrAccountant, enforceOrgIsolation);

// GET /api/payroll/settings
router.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const data = await payrollService.getPaySettings(req.user!, branchId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/payroll/settings/:userId
router.put(
  '/settings/:userId',
  requireOrgAdmin,
  validate(paySettingsSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await payrollService.upsertPaySettings(String(req.params.userId), req.body, req.user!);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/payroll/generate
router.post('/generate', validate(generatePayrollSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await payrollService.generatePayroll(req.body, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// POST /api/payroll/regenerate/:userId
// Recalculate payslip for a single employee after an attendance correction
router.post('/regenerate/:userId', requireOrgAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear, bsMonth, reason } = req.body;
    if (!bsYear || !bsMonth) throw new Error('bsYear and bsMonth are required');
    if (!reason) throw new Error('reason is required for audit trail');
    const data = await payrollService.regenerateForEmployee(String(req.params.userId), Number(bsYear), Number(bsMonth), reason, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/records
router.get('/records', validate(payrollRecordsQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear, bsMonth, branchId } = req.query as any;
    const data = await payrollService.getRecords(bsYear, bsMonth, req.user!, branchId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/payroll/records/:id/status
router.put('/records/:id/status', requireFeature('featurePayrollWorkflow'), validate(payrollStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role === 'ORG_ACCOUNTANT' && req.body.status === 'APPROVED') {
      return res.status(403).json({ error: { message: 'Accountants cannot approve payroll' } });
    }
    const data = await payrollService.updateStatus(String(req.params.id), req.body.status, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/records/:id/audit
router.get('/records/:id/audit', requireOrgAdminOrAccountant, async (req: AuthRequest, res: Response, next: NextFunction) => {  try {
    const data = await payrollService.getAuditLog(String(req.params.id), req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/payroll/records/bulk-status
router.put('/records/bulk-status', requireFeature('featurePayrollWorkflow'), validate(bulkPayrollStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role === 'ORG_ACCOUNTANT' && req.body.status === 'APPROVED') {
      return res.status(403).json({ error: { message: 'Accountants cannot approve payroll' } });
    }
    const data = await payrollService.bulkUpdateStatus(req.body.bsYear, req.body.bsMonth, req.body.status, req.user!);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get('/multi-month', requireFeature('featurePayrollWorkflow'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fromBsYear, fromBsMonth, toBsYear, toBsMonth, branchId } = req.query;
    if (!fromBsYear || !fromBsMonth || !toBsYear || !toBsMonth) {
      return res.status(400).json({ error: { message: 'fromBsYear, fromBsMonth, toBsYear, toBsMonth are required' } });
    }
    const data = await payrollService.getMultiMonthData(Number(fromBsYear), Number(fromBsMonth), Number(toBsYear), Number(toBsMonth), req.user!, branchId as string | undefined);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get('/multi-month/export', requireFeature('featurePayrollWorkflow'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fromBsYear, fromBsMonth, toBsYear, toBsMonth, branchId } = req.query;
    if (!fromBsYear || !fromBsMonth || !toBsYear || !toBsMonth) {
      return res.status(400).json({ error: { message: 'Required params missing' } });
    }
    const result = await payrollService.getMultiMonthData(Number(fromBsYear), Number(fromBsMonth), Number(toBsYear), Number(toBsMonth), req.user!, branchId as string | undefined);
    const monthHeaders = result.months.map((m: any) => `${m.bsMonth}/${m.bsYear}`).join(',');
    const header = `Employee ID,Employee Name,${monthHeaders},Total`;
    const rows = result.employees.map((emp: any) => {
      const name = `"${emp.employee.firstName} ${emp.employee.lastName}"`;
      const monthValues = result.months.map((m: any) => {
        const monthKey = `${m.bsYear}-${m.bsMonth}`;
        const monthData = emp.months[monthKey];
        return monthData ? monthData.netSalary.toFixed(2) : '0.00';
      }).join(',');
      return `${emp.employee.employeeId},${name},${monthValues},${emp.totals.netSalary.toFixed(2)}`;
    });
    const grandTotalRow = `,GRAND TOTAL,${result.months.map((m: any) => {
      let monthTotal = 0;
      result.employees.forEach((emp: any) => {
        const monthKey = `${m.bsYear}-${m.bsMonth}`;
        const monthData = emp.months[monthKey];
        if (monthData) monthTotal += monthData.netSalary;
      });
      return monthTotal.toFixed(2);
    }).join(',')},${result.grandTotals.netSalary.toFixed(2)}`;
    rows.push('');
    rows.push(grandTotalRow);
    const csv = header + '\n' + rows.join('\n');
    const filename = `multi-month-salary-${fromBsYear}-${fromBsMonth}-to-${toBsYear}-${toBsMonth}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/payslip/:recordId/pdf
router.get('/payslip/:recordId/pdf', requireFeature('featureFileDownload'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.payrollRecord.findUnique({
      where: { id: String(req.params.recordId) },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            paySettings: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        organization: { select: { name: true, address: true } },
      },
    });
    if (!record) return res.status(404).json({ error: { message: 'Record not found' } });
    if (record.organizationId !== req.user!.organizationId) return res.status(403).json({ error: { message: 'Access denied' } });

    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
    const ps = record.membership.paySettings;
    const pdfStream = generatePayslipPDF({
      orgName: record.organization.name,
      orgAddress: record.organization.address || undefined,
      employee: {
        firstName: record.membership.user.firstName,
        lastName: record.membership.user.lastName,
        employeeId: record.membership.employeeId || '',
        email: record.membership.user.email || '',
      },
      bsYear: record.bsYear, bsMonth: record.bsMonth,
      workingDaysInMonth: record.workingDaysInMonth, holidaysInMonth: record.holidaysInMonth,
      daysPresent: record.daysPresent, daysAbsent: record.daysAbsent,
      overtimeHours: toNum(record.overtimeHours),
      basicSalary: toNum(record.basicSalary), dearnessAllowance: toNum(record.dearnessAllowance),
      transportAllowance: toNum(record.transportAllowance), medicalAllowance: toNum(record.medicalAllowance),
      otherAllowances: toNum(record.otherAllowances), overtimePay: toNum(record.overtimePay),
      grossSalary: toNum(record.grossSalary), absenceDeduction: toNum(record.absenceDeduction),
      employeeSsf: toNum(record.employeeSsf), employerSsf: toNum(record.employerSsf),
      employeePf: toNum(record.employeePf), employerPf: toNum(record.employerPf),
      citDeduction: toNum(record.citDeduction), advanceDeduction: toNum(record.advanceDeduction),
      dashainBonus: toNum(record.dashainBonus), tds: toNum(record.tds),
      totalDeductions: toNum(record.totalDeductions), netSalary: toNum(record.netSalary),
      isMarried: record.isMarried, status: record.status,
      bankName: ps?.bankName || undefined, bankAccountNumber: ps?.bankAccountNumber || undefined,
    });
    const filename = 'payslip-' + record.membership.employeeId + '-' + record.bsYear + '-' + record.bsMonth + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    pdfStream.pipe(res);
  } catch (error) {
    next(error);
  }
});
// GET /api/payroll/export/detailed?bsYear=X&bsMonth=Y
// Full internal payroll breakdown CSV — admin and accountant
router.get('/export/detailed', requireFeature('featureFileDownload'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear, bsMonth } = req.query as any;
    if (!bsYear || !bsMonth) return res.status(400).json({ error: { message: 'bsYear and bsMonth required' } });

    const records = await prisma.payrollRecord.findMany({
      where: { organizationId: req.user!.organizationId!, bsYear: Number(bsYear), bsMonth: Number(bsMonth) },
      include: {
        membership: {
          select: {
            employeeId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { membership: { user: { firstName: 'asc' } } },
    });

    if (records.length === 0) return res.status(404).json({ error: { message: 'No payroll records found' } });

    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');

    const header = [
      'SN', 'Employee ID', 'Employee Name',
      'Days Present', 'Days Absent', 'Overtime Hours',
      'Basic Salary', 'Dearness Allowance', 'Transport Allowance',
      'Medical Allowance', 'Other Allowances', 'Overtime Pay',
      'Dashain Bonus', 'Gross Salary',
      'Employee SSF', 'Employer SSF',
      'Employee PF', 'Employer PF',
      'CIT Deduction', 'TDS', 'Advance Deduction',
      'Total Deductions', 'Net Salary', 'Status',
    ].join(',');

    const rows = records.map((r, i) => [
      i + 1,
      r.membership.employeeId || '',
      '"' + r.membership.user.firstName + ' ' + r.membership.user.lastName + '"',
      r.daysPresent,
      r.daysAbsent,
      toNum(r.overtimeHours).toFixed(2),
      toNum(r.basicSalary).toFixed(2),
      toNum(r.dearnessAllowance).toFixed(2),
      toNum(r.transportAllowance).toFixed(2),
      toNum(r.medicalAllowance).toFixed(2),
      toNum(r.otherAllowances).toFixed(2),
      toNum(r.overtimePay).toFixed(2),
      toNum(r.dashainBonus).toFixed(2),
      toNum(r.grossSalary).toFixed(2),
      toNum(r.employeeSsf).toFixed(2),
      toNum(r.employerSsf).toFixed(2),
      toNum(r.employeePf).toFixed(2),
      toNum(r.employerPf).toFixed(2),
      toNum(r.citDeduction).toFixed(2),
      toNum(r.tds).toFixed(2),
      toNum(r.advanceDeduction).toFixed(2),
      toNum(r.totalDeductions).toFixed(2),
      toNum(r.netSalary).toFixed(2),
      r.status,
    ].join(','));

    // Totals row
    const totals = [
      '', '', 'TOTAL',
      records.reduce((s, r) => s + r.daysPresent, 0),
      records.reduce((s, r) => s + r.daysAbsent, 0),
      records.reduce((s, r) => s + toNum(r.overtimeHours), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.basicSalary), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.dearnessAllowance), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.transportAllowance), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.medicalAllowance), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.otherAllowances), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.overtimePay), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.dashainBonus), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.grossSalary), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.employeeSsf), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.employerSsf), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.employeePf), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.employerPf), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.citDeduction), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.tds), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.advanceDeduction), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.totalDeductions), 0).toFixed(2),
      records.reduce((s, r) => s + toNum(r.netSalary), 0).toFixed(2),
      '',
    ].join(',');
    rows.push(totals);

    const csv = header + '\n' + rows.join('\n');
    const filename = `payroll-detailed-${bsYear}-${bsMonth}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/export/bank-sheet?bsYear=X&bsMonth=Y
router.get('/export/bank-sheet', requireFeature('featureFileDownload'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { bsYear, bsMonth } = req.query as any;
    if (!bsYear || !bsMonth) return res.status(400).json({ error: { message: 'bsYear and bsMonth required' } });
    const records = await prisma.payrollRecord.findMany({
      where: { organizationId: req.user!.organizationId!, bsYear: Number(bsYear), bsMonth: Number(bsMonth) },
      include: {
        membership: {
          select: {
            employeeId: true,
            paySettings: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (records.length === 0) return res.status(404).json({ error: { message: 'No payroll records found' } });
    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
    const header = 'SN,Employee ID,Employee Name,Bank Name,Account Name,Account Number,Net Salary,Remarks';
    const rows = records.map((r, i) => {
      const ps = r.membership.paySettings;
      return [
        i + 1,
        r.membership.employeeId,
        '"' + r.membership.user.firstName + ' ' + r.membership.user.lastName + '"',
        '"' + (ps?.bankName || '') + '"',
        '"' + (ps?.bankAccountName || '') + '"',
        '"' + (ps?.bankAccountNumber || '') + '"',
        toNum(r.netSalary).toFixed(2),
        r.status,
      ].join(',');
    });
    const totalNet = records.reduce((sum, r) => sum + toNum(r.netSalary), 0);
    rows.push(',,,,,,');
    rows.push(',,,,,TOTAL,' + totalNet.toFixed(2) + ',');
    const csv = header + '\n' + rows.join('\n');
    const filename = 'bank-salary-sheet-' + bsYear + '-' + bsMonth + '.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/annual-report?bsYear=X&branchId=Y
router.get('/annual-report', requireFeature('featurePayrollWorkflow'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bsYear = Number(req.query.bsYear);
    if (!bsYear) return res.status(400).json({ error: { message: 'bsYear required' } });
    // Phase 10 — BRANCH_ADMIN sees only their branch; ORG_ADMIN may
    // voluntarily narrow via ?branchId=. PayrollRecord has no direct
    // branchId, so we filter via the membership relation (same pattern
    // used by getRecords / getMultiMonthData).
    const scope = resolveBranchFilter(req.user, req.query.branchId as string | undefined);
    const records = await prisma.payrollRecord.findMany({
      where: {
        organizationId: req.user!.organizationId!,
        bsYear,
        ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
      },
      include: {
        membership: {
          select: {
            id: true,
            employeeId: true,
            paySettings: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: [{ membershipId: 'asc' }, { bsMonth: 'asc' }],
    });
    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');

    // Group by membership
    const employeeMap: Record<string, any> = {};
    for (const r of records) {
      if (!employeeMap[r.membershipId]) {
        const ps = r.membership.paySettings;
        employeeMap[r.membershipId] = {
          membershipId: r.membershipId,
          employee: {
            firstName: r.membership.user.firstName,
            lastName: r.membership.user.lastName,
            employeeId: r.membership.employeeId,
          },
          isMarried: (r as any).isMarried || false,
          months: [],
          totalBasic: 0, totalGross: 0, totalNet: 0,
          totalEmployeeSsf: 0, totalEmployerSsf: 0,
          totalEmployeePf: 0, totalEmployerPf: 0,
          totalCit: 0, totalTds: 0, totalDashainBonus: 0,
          totalDeductions: 0, totalDaysPresent: 0, totalDaysAbsent: 0,
          bankName: ps?.bankName || null, bankAccountNumber: ps?.bankAccountNumber || null,
        };
      }
      const emp = employeeMap[r.membershipId];
      emp.months.push({ bsMonth: r.bsMonth, status: r.status });
      emp.totalBasic += toNum(r.basicSalary);
      emp.totalGross += toNum(r.grossSalary);
      emp.totalNet += toNum(r.netSalary);
      emp.totalEmployeeSsf += toNum(r.employeeSsf);
      emp.totalEmployerSsf += toNum(r.employerSsf);
      emp.totalEmployeePf += toNum(r.employeePf);
      emp.totalEmployerPf += toNum(r.employerPf);
      emp.totalCit += toNum(r.citDeduction);
      emp.totalTds += toNum(r.tds);
      emp.totalDashainBonus += toNum(r.dashainBonus);
      emp.totalDeductions += toNum(r.totalDeductions);
      emp.totalDaysPresent += r.daysPresent;
      emp.totalDaysAbsent += r.daysAbsent;
    }
    const employees = Object.values(employeeMap).map((e: any) => ({
      ...e,
      totalBasic: Math.round(e.totalBasic * 100) / 100,
      totalGross: Math.round(e.totalGross * 100) / 100,
      totalNet: Math.round(e.totalNet * 100) / 100,
      totalEmployeeSsf: Math.round(e.totalEmployeeSsf * 100) / 100,
      totalEmployerSsf: Math.round(e.totalEmployerSsf * 100) / 100,
      totalEmployeePf: Math.round(e.totalEmployeePf * 100) / 100,
      totalEmployerPf: Math.round(e.totalEmployerPf * 100) / 100,
      totalCit: Math.round(e.totalCit * 100) / 100,
      totalTds: Math.round(e.totalTds * 100) / 100,
      totalDashainBonus: Math.round(e.totalDashainBonus * 100) / 100,
      totalDeductions: Math.round(e.totalDeductions * 100) / 100,
      monthsProcessed: e.months.length,
      totals: {
    basicSalary:     Math.round(e.totalBasic        * 100) / 100,
    grossSalary:     Math.round(e.totalGross        * 100) / 100,
    netSalary:       Math.round(e.totalNet          * 100) / 100,
    employeeSsf:     Math.round(e.totalEmployeeSsf  * 100) / 100,
    employeePf:      Math.round(e.totalEmployeePf   * 100) / 100,
    tds:             Math.round(e.totalTds          * 100) / 100,
    totalDeductions: Math.round(e.totalDeductions   * 100) / 100,
  },
    }));
    res.json({ data: { bsYear, employees } });
  } catch (error) {
    next(error);
  }
});

// GET /api/payroll/annual-report/csv?bsYear=X&branchId=Y
router.get('/annual-report/csv', requireFeature('featureFileDownload'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bsYear = Number(req.query.bsYear);
    if (!bsYear) return res.status(400).json({ error: { message: 'bsYear required' } });
    // Phase 10 — same branch filter logic as the JSON endpoint above.
    const scope = resolveBranchFilter(req.user, req.query.branchId as string | undefined);
    const records = await prisma.payrollRecord.findMany({
      where: {
        organizationId: req.user!.organizationId!,
        bsYear,
        ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
      },
      include: {
        membership: {
          select: {
            employeeId: true,
            paySettings: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ membershipId: 'asc' }, { bsMonth: 'asc' }],
    });
    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(v?.toString() || '0');
    const empMap: Record<string, any> = {};
    for (const r of records) {
      if (!empMap[r.membershipId]) {
        empMap[r.membershipId] = {
          emp: {
            employeeId: r.membership.employeeId,
            firstName: r.membership.user.firstName,
            lastName: r.membership.user.lastName,
          },
          sums: { basic: 0, gross: 0, eSsf: 0, rSsf: 0, ePf: 0, rPf: 0, cit: 0, tds: 0, bonus: 0, deductions: 0, net: 0 },
        };
      }
      const s = empMap[r.membershipId].sums;
      s.basic += toNum(r.basicSalary); s.gross += toNum(r.grossSalary);
      s.eSsf += toNum(r.employeeSsf); s.rSsf += toNum(r.employerSsf);
      s.ePf += toNum(r.employeePf); s.rPf += toNum(r.employerPf);
      s.cit += toNum(r.citDeduction); s.tds += toNum(r.tds);
      s.bonus += toNum(r.dashainBonus); s.deductions += toNum(r.totalDeductions);
      s.net += toNum(r.netSalary);
    }
    const header = 'SN,Employee ID,Name,Annual Basic,Annual Gross,Employee SSF,Employer SSF,Employee PF,Employer PF,CIT,TDS (Tax),Dashain Bonus,Total Deductions,Annual Net';
    let sn = 0;
    const rows = Object.values(empMap).map((e: any) => {
      sn++;
      const s = e.sums;
      return [sn, e.emp.employeeId, '"' + e.emp.firstName + ' ' + e.emp.lastName + '"',
        s.basic.toFixed(2), s.gross.toFixed(2), s.eSsf.toFixed(2), s.rSsf.toFixed(2),
        s.ePf.toFixed(2), s.rPf.toFixed(2), s.cit.toFixed(2), s.tds.toFixed(2),
        s.bonus.toFixed(2), s.deductions.toFixed(2), s.net.toFixed(2)].join(',');
    });
    const csv = header + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="annual-tax-report-' + bsYear + '.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

export { empRouter as employeePayrollRouter };

// GET /api/payroll/tds-slabs — Read-only TDS slabs for org admin
router.get('/tds-slabs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.systemConfig.findFirst({
      where: { key: 'tds_slabs' },
      orderBy: { updatedAt: 'desc' },
    });
    if (config) {
      res.json({ data: JSON.parse(config.value) });
    } else {
      res.json({ data: {
        fiscalYear: '2081/82',
        unmarriedFirstSlab: 500000,
        marriedFirstSlab: 600000,
        slabs: [
          { limit: 200000, rate: 10, label: 'Second slab' },
          { limit: 300000, rate: 20, label: 'Third slab' },
          { limit: 1000000, rate: 30, label: 'Fourth slab' },
          { limit: 0, rate: 36, label: 'Remaining (above)' },
        ],
        firstSlabRate: 1,
      }});
    }
  } catch (error) { next(error); }
});

export default router;