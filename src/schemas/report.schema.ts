import { z } from 'zod';

// Optional branch filter — ORG_ADMIN/ORG_ACCOUNTANT can voluntarily narrow
// reports to a single branch. BRANCH_ADMIN's scope is already locked to
// their own branch server-side, so passing this param has no effect for them.
const branchIdFilter = z.string().uuid().optional();

export const dailyReportQuerySchema = z.object({
  date: z.string().optional(), // AD date string, defaults to today
  branchId: branchIdFilter,
});

export const weeklyReportQuerySchema = z.object({
  startDate: z.string().optional(), // AD date string, defaults to current week start
  branchId: branchIdFilter,
});

export const monthlyReportQuerySchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090).optional(),
  bsMonth: z.coerce.number().int().min(1).max(12).optional(),
  // Fallback to AD year/month if BS not provided
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  branchId: branchIdFilter,
});
