/**
 * payroll.service — branch-scope tests (Phase 8a / 8b / Phase 10)
 *
 * Focused on the resolveBranchFilter call sites in getRecords (and the
 * shared membership-relation pattern used throughout the service). The
 * pattern is the same across getRecords, getMultiMonthData, getAuditLog,
 * and the Annual tab routes added in Phase 10; covering getRecords is
 * sufficient to verify the abstraction is applied correctly.
 *
 * Key property: PayrollRecord has no direct branchId column. The filter
 * goes through the membership relation: `where.membership = { branchId }`.
 * Verifying this shape is what these tests do.
 *
 * Mock strategy: payrollRecord.findMany returns [] so mapPayrollRecord
 * never runs — we only care about the where-clause arguments.
 */

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    payrollRecord: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  },
}));

// payroll.service imports holiday.service and roster.service (used during
// generation, not getRecords). Stub them to avoid Prisma boot errors.
jest.mock('../holiday.service', () => ({
  holidayService: {},
}));
jest.mock('../roster.service', () => ({
  rosterService: {},
  parseDaySchedules: jest.fn(),
}));
jest.mock('../email.service', () => ({
  emailService: {},
}));

import { PayrollService } from '../payroll.service';

// ── Constants ──────────────────────────────────────────────────────────────

const ORG_ID   = 'org-1';
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    membershipId: 'mem-1',
    organizationId: ORG_ID,
    role: 'ORG_ADMIN',
    branchId: null,
    ...overrides,
  } as any;
}

let mockPrisma: any;
let payrollService: PayrollService;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
  payrollService = new PayrollService();

  // Return empty arrays — getRecords maps over records, so [] is the
  // simplest valid response that avoids mapPayrollRecord throwing.
  mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
});

// ── getRecords — branch-scope ─────────────────────────────────────────────

describe('getRecords — branch-scope (Phase 8a / 8b / Phase 10)', () => {
  const BS_YEAR  = 2082;
  const BS_MONTH = 2;

  it('BRANCH_ADMIN: membership filter applied via membership relation', async () => {
    await payrollService.getRecords(
      BS_YEAR,
      BS_MONTH,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
    );

    const queryArg = mockPrisma.payrollRecord.findMany.mock.calls[0][0];
    // PayrollRecord has no direct branchId — must filter via the membership relation.
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_A });
  });

  it('ORG_ADMIN with explicit branchId: membership filter applied (voluntary narrowing)', async () => {
    await payrollService.getRecords(
      BS_YEAR,
      BS_MONTH,
      makeUser({ role: 'ORG_ADMIN' }),
      BRANCH_B,
    );

    const queryArg = mockPrisma.payrollRecord.findMany.mock.calls[0][0];
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_B });
  });

  it('ORG_ADMIN without branchId: no membership filter — org-wide view', async () => {
    await payrollService.getRecords(
      BS_YEAR,
      BS_MONTH,
      makeUser({ role: 'ORG_ADMIN' }),
      // no branchIdFilter
    );

    const queryArg = mockPrisma.payrollRecord.findMany.mock.calls[0][0];
    // membership key must be absent — an undefined branchId would silently
    // corrupt the query by matching only records with no membership.
    expect(queryArg.where.membership).toBeUndefined();
  });

  it('BRANCH_ADMIN cannot spoof a different branch via branchIdFilter argument', async () => {
    await payrollService.getRecords(
      BS_YEAR,
      BS_MONTH,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      BRANCH_B, // attempted spoof
    );

    const queryArg = mockPrisma.payrollRecord.findMany.mock.calls[0][0];
    // resolveBranchFilter must return BRANCH_A (locked), not the spoofed BRANCH_B.
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_A });
  });

  it('includes organizationId in every query', async () => {
    // Regression guard: the branch-scope additions must not accidentally drop
    // the org-isolation where clause.
    await payrollService.getRecords(
      BS_YEAR,
      BS_MONTH,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
    );

    const queryArg = mockPrisma.payrollRecord.findMany.mock.calls[0][0];
    expect(queryArg.where.organizationId).toBe(ORG_ID);
  });
});
