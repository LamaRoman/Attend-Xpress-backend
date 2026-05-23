import { z } from 'zod';

export const createLeaveSchema = z.object({
  startDate: z.string().transform((v) => new Date(v)),
  endDate: z.string().transform((v) => new Date(v)),
  reason: z.string().min(1, 'Reason is required').max(500),
  type: z.enum(['SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'MATERNITY', 'PATERNITY']),
});

export const approveRejectLeaveSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionMessage: z.string().optional(),
});

export const leaveListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  userId: z.string().uuid().optional(),
  type: z.enum(['SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'MATERNITY', 'PATERNITY']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().max(100).optional(),
  bsYear: z.coerce.number().int().min(2070).max(2090).optional(),
  bsMonth: z.coerce.number().int().min(1).max(12).optional(),
  // Phase 8b — ORG_ADMIN/ORG_ACCOUNTANT may voluntarily narrow to one branch.
  // Ignored for BRANCH_ADMIN (scope is already locked server-side).
  branchId: z.string().uuid().optional(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;