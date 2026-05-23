import { z } from 'zod';

export const paySettingsSchema = z.object({
  basicSalary: z.coerce.number().min(0, 'Basic salary must be positive'),
  dearnessAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  medicalAllowance: z.coerce.number().min(0).default(0),
  otherAllowances: z.coerce.number().min(0).default(0),
  overtimeRatePerHour: z.coerce.number().min(0).default(0),
  ssfEnabled: z.boolean().default(true),
  employeeSsfRate: z.coerce.number().min(0).max(100).default(11),
  employerSsfRate: z.coerce.number().min(0).max(100).default(20),
  tdsEnabled: z.boolean().default(true),
  pfEnabled: z.boolean().default(false),
  employeePfRate: z.coerce.number().min(0).max(100).default(10),
  employerPfRate: z.coerce.number().min(0).max(100).default(10),
  citEnabled: z.boolean().default(false),
  citAmount: z.coerce.number().min(0).default(0),
  isMarried: z.boolean().default(false),
  advanceDeduction: z.coerce.number().min(0).default(0),
  dashainBonusPercent: z.number().int().min(0).max(200).nullable().optional(),
  bankName: z.string().optional(),
  bankAccountName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
});

export const generatePayrollSchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090),
  bsMonth: z.coerce.number().int().min(1).max(12),
  organizationId: z.string().optional(),
  // Per-employee overtime overrides: key = membershipId, value = override hours (>= 0)
  // If provided for an employee, replaces the calculated overtime hours.
  overtimeOverrides: z.record(z.string(), z.coerce.number().min(0)).optional(),
  reason: z.string().optional(),
});

export const payrollRecordsQuerySchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090),
  bsMonth: z.coerce.number().int().min(1).max(12),
  // Phase 8b — ORG_ADMIN may voluntarily narrow to a single branch.
  // Ignored for BRANCH_ADMIN (already locked to their own branch).
  branchId: z.string().uuid().optional(),
});

export const payrollStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PROCESSED', 'APPROVED', 'PAID']),
});

export const bulkPayrollStatusSchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090),
  bsMonth: z.coerce.number().int().min(1).max(12),
  status: z.enum(['DRAFT', 'PROCESSED', 'APPROVED', 'PAID']),
});

export type PaySettingsInput = z.infer<typeof paySettingsSchema>;
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;