/**
 * leave.service — branch-scope tests (Phase 8a / 8b)
 *
 * The main leave.service.test.ts covers the full requestLeave / updateLeaveStatus
 * / cancelLeave / getLeaveSummary behaviour. This file covers only the
 * branch-scope paths added in Phases 8a and 8b that have no existing coverage:
 *
 *   updateLeaveStatus — BRANCH_ADMIN cross-branch access returns NotFound
 *   listLeaves        — BRANCH_ADMIN query includes membership.branchId filter
 *   listLeaves        — ORG_ADMIN with explicit branchId narrows the query
 *   listLeaves        — ORG_ADMIN without branchId applies no membership filter
 *
 * Strategy: mock Prisma + email + balance exactly as leave.service.test.ts does
 * so the two files can coexist with no global-state conflicts.
 */

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    leave: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    orgMembership: {
      findMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../email.service', () => ({
  emailService: {
    sendLeaveRequestNotification: jest.fn().mockResolvedValue(undefined),
    sendLeaveDecisionNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../leaveBalance.service', () => ({
  leaveBalanceService: {
    handleLeaveDecision: jest.fn().mockResolvedValue(undefined),
  },
}));

import { leaveService } from '../leave.service';
import { NotFoundError } from '../../lib/errors';

// ── Constants ──────────────────────────────────────────────────────────────

const ORG_ID      = 'org-1';
const BRANCH_A    = 'branch-a';
const BRANCH_B    = 'branch-b';
const LEAVE_ID    = 'leave-1';
const MEMBERSHIP_ID = 'mem-1';
const USER_ID     = 'user-1';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: USER_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    role: 'ORG_ADMIN',
    branchId: null,
    ...overrides,
  } as any;
}

function makeLeave(membershipBranchId: string | null = BRANCH_A) {
  return {
    id: LEAVE_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    startDate: new Date('2025-06-01T00:00:00Z'),
    endDate: new Date('2025-06-05T00:00:00Z'),
    reason: 'holiday',
    type: 'ANNUAL',
    status: 'PENDING',
    bsStartYear: 2082,
    bsStartMonth: 2,
    bsStartDay: 18,
    bsEndYear: 2082,
    bsEndMonth: 2,
    bsEndDay: 22,
    approvedBy: null,
    approvedAt: null,
    rejectionMessage: null,
    membership: {
      branchId: membershipBranchId,
      employeeId: 'EMP-001',
      user: { firstName: 'Alice', lastName: 'A', email: 'alice@example.com' },
    },
    approver: null,
  };
}

let mockPrisma: any;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
});

// ── updateLeaveStatus — branch-scope ──────────────────────────────────────

describe('updateLeaveStatus — branch-scope (Phase 8a)', () => {
  it('throws NotFoundError when BRANCH_ADMIN tries to approve a leave in a different branch', async () => {
    // Leave belongs to Branch A; caller is BRANCH_ADMIN for Branch B.
    // Must look like "not found" — never reveal the leave exists in another branch.
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave(BRANCH_A));

    await expect(
      leaveService.updateLeaveStatus(
        LEAVE_ID,
        'APPROVED',
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_B }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(mockPrisma.leave.update).not.toHaveBeenCalled();
  });

  it('allows BRANCH_ADMIN to approve a leave in their own branch', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave(BRANCH_A));
    mockPrisma.leave.update.mockResolvedValue({
      ...makeLeave(BRANCH_A),
      status: 'APPROVED',
      approver: { firstName: 'Admin', lastName: 'B' },
    });

    await expect(
      leaveService.updateLeaveStatus(
        LEAVE_ID,
        'APPROVED',
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).resolves.toBeDefined();

    expect(mockPrisma.leave.update).toHaveBeenCalledTimes(1);
  });
});

// ── listLeaves — branch-scope ─────────────────────────────────────────────

describe('listLeaves — branch-scope (Phase 8a / 8b)', () => {
  beforeEach(() => {
    mockPrisma.leave.findMany.mockResolvedValue([]);
    mockPrisma.leave.count.mockResolvedValue(0);
  });

  it('BRANCH_ADMIN: membership.branchId filter is added to the leave query', async () => {
    await leaveService.listLeaves(
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      20,
      0,
      {},
    );

    const queryArg = mockPrisma.leave.findMany.mock.calls[0][0];
    // Phase 8a: leave has no direct branchId — filter goes through membership.
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_A });
  });

  it('ORG_ADMIN with explicit branchId: membership filter is applied (voluntary narrowing)', async () => {
    await leaveService.listLeaves(
      makeUser({ role: 'ORG_ADMIN' }),
      20,
      0,
      { branchId: BRANCH_B },
    );

    const queryArg = mockPrisma.leave.findMany.mock.calls[0][0];
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_B });
  });

  it('ORG_ADMIN without branchId: no membership filter applied (org-wide view)', async () => {
    await leaveService.listLeaves(
      makeUser({ role: 'ORG_ADMIN' }),
      20,
      0,
      {},
    );

    const queryArg = mockPrisma.leave.findMany.mock.calls[0][0];
    // membership key must be absent — spreading an empty branchWhere({branchId: null})
    // into where.membership would produce undefined which could silently break queries.
    expect(queryArg.where.membership).toBeUndefined();
  });

  it('BRANCH_ADMIN cannot spoof a different branch via the branchId filter', async () => {
    // Even if a BRANCH_ADMIN passes ?branchId=branch-b in the request,
    // resolveBranchFilter ignores it and returns their own locked branch.
    await leaveService.listLeaves(
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      20,
      0,
      { branchId: BRANCH_B }, // attempted spoof
    );

    const queryArg = mockPrisma.leave.findMany.mock.calls[0][0];
    // Must be locked to BRANCH_A, not the spoofed BRANCH_B.
    expect(queryArg.where.membership).toEqual({ branchId: BRANCH_A });
  });
});
