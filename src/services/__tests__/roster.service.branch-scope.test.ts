/**
 * roster.service — branch-scope tests (Phase 8a / 8b)
 *
 * Covers three methods that received branch-scope enforcement in Phase 8a:
 *
 *   listSchedules  — BRANCH_ADMIN gets OR filter (org-wide + own-branch);
 *                    ORG_ADMIN with branchId gets same; without: no filter.
 *   getSchedule    — BRANCH_ADMIN accessing an out-of-branch employee schedule
 *                    gets NotFound; org-wide schedules (membershipId null) are
 *                    always readable by any admin.
 *   createSchedule — BRANCH_ADMIN attempting to create an org-wide schedule
 *                    (no membershipId) gets ConflictError.
 */

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    rosterSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    orgMembership: {
      findFirst: jest.fn(),
    },
  },
}));

import { RosterService } from '../roster.service';
import { NotFoundError, ConflictError } from '../../lib/errors';

// ── Constants ──────────────────────────────────────────────────────────────

const ORG_ID      = 'org-1';
const BRANCH_A    = 'branch-a';
const BRANCH_B    = 'branch-b';
const SCHEDULE_ID = 'sched-1';
const MEMBERSHIP_ID = 'mem-1';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    role: 'ORG_ADMIN',
    branchId: null,
    ...overrides,
  } as any;
}

function makeSchedule(membershipBranchId: string | null = null) {
  return {
    id: SCHEDULE_ID,
    organizationId: ORG_ID,
    membershipId: membershipBranchId === null ? null : MEMBERSHIP_ID,
    cycleType: 'WEEKLY',
    daySchedules: { '1': { start: '09:00', end: '17:00' } },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    label: null,
    deletedAt: null,
    membership: membershipBranchId === null
      ? null
      : {
          id: MEMBERSHIP_ID,
          employeeId: 'EMP-001',
          branchId: membershipBranchId,
          user: { firstName: 'Alice', lastName: 'A' },
        },
  };
}

let mockPrisma: any;
let rosterService: RosterService;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
  rosterService = new RosterService();
});

// ── listSchedules — branch-scope ──────────────────────────────────────────

describe('listSchedules — branch-scope (Phase 8a / 8b)', () => {
  beforeEach(() => {
    mockPrisma.rosterSchedule.findMany.mockResolvedValue([]);
  });

  it('BRANCH_ADMIN: OR filter includes org-wide schedules and own-branch employee schedules', async () => {
    await rosterService.listSchedules(makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }), {});

    const queryArg = mockPrisma.rosterSchedule.findMany.mock.calls[0][0];
    // BRANCH_ADMIN can see org-wide schedules (they apply to their employees too)
    // but only per-employee schedules for their own branch.
    expect(queryArg.where.OR).toEqual([
      { membershipId: null },
      { membership: { branchId: BRANCH_A } },
    ]);
  });

  it('ORG_ADMIN with explicit branchId: same OR filter applied (voluntary narrowing)', async () => {
    await rosterService.listSchedules(makeUser({ role: 'ORG_ADMIN' }), { branchId: BRANCH_B });

    const queryArg = mockPrisma.rosterSchedule.findMany.mock.calls[0][0];
    expect(queryArg.where.OR).toEqual([
      { membershipId: null },
      { membership: { branchId: BRANCH_B } },
    ]);
  });

  it('ORG_ADMIN without branchId: no OR filter — org-wide view', async () => {
    await rosterService.listSchedules(makeUser({ role: 'ORG_ADMIN' }), {});

    const queryArg = mockPrisma.rosterSchedule.findMany.mock.calls[0][0];
    expect(queryArg.where.OR).toBeUndefined();
  });

  it('BRANCH_ADMIN cannot spoof a different branch via the branchId filter', async () => {
    await rosterService.listSchedules(
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      { branchId: BRANCH_B }, // attempted spoof
    );

    const queryArg = mockPrisma.rosterSchedule.findMany.mock.calls[0][0];
    // Must be locked to BRANCH_A, not the spoofed BRANCH_B.
    expect(queryArg.where.OR).toEqual([
      { membershipId: null },
      { membership: { branchId: BRANCH_A } },
    ]);
  });
});

// ── getSchedule — branch-scope ────────────────────────────────────────────

describe('getSchedule — branch-scope (Phase 8a)', () => {
  it('BRANCH_ADMIN accessing an employee schedule from a different branch gets NotFound', async () => {
    // Schedule belongs to an employee in Branch B; caller is Branch A admin.
    mockPrisma.rosterSchedule.findFirst.mockResolvedValue(makeSchedule(BRANCH_B));

    await expect(
      rosterService.getSchedule(
        SCHEDULE_ID,
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('BRANCH_ADMIN can read an org-wide schedule (membershipId null)', async () => {
    // Org-wide schedules (no membership) apply to everyone including branch employees.
    mockPrisma.rosterSchedule.findFirst.mockResolvedValue(makeSchedule(null));

    await expect(
      rosterService.getSchedule(
        SCHEDULE_ID,
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).resolves.toBeDefined();
  });

  it('BRANCH_ADMIN can read a schedule for an employee in their own branch', async () => {
    mockPrisma.rosterSchedule.findFirst.mockResolvedValue(makeSchedule(BRANCH_A));

    await expect(
      rosterService.getSchedule(
        SCHEDULE_ID,
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).resolves.toBeDefined();
  });
});

// ── createSchedule — branch-scope ────────────────────────────────────────

describe('createSchedule — branch-scope (Phase 8a)', () => {
  const validInput: any = {
    cycleType: 'WEEKLY',
    daySchedules: { '1': { start: '09:00', end: '17:00' } },
    effectiveFrom: '2025-01-01',
    // membershipId deliberately omitted → org-wide schedule
  };

  it('BRANCH_ADMIN attempting to create an org-wide schedule gets ConflictError', async () => {
    // Org-wide schedules affect employees outside the branch admin's scope.
    // The service must block this before hitting Prisma.
    await expect(
      rosterService.createSchedule(
        validInput,
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).rejects.toThrow(ConflictError);

    expect(mockPrisma.rosterSchedule.create).not.toHaveBeenCalled();
  });

  it('BRANCH_ADMIN targeting an out-of-branch employee gets NotFoundError (membership not found)', async () => {
    // branchWhere(scope) is spread into the orgMembership.findFirst where-clause,
    // so an out-of-branch membership lookup returns null → NotFoundError.
    // This simulates what happens when the membership exists but is in another branch.
    mockPrisma.orgMembership.findFirst.mockResolvedValue(null);

    await expect(
      rosterService.createSchedule(
        { ...validInput, membershipId: 'mem-other-branch' },
        makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(mockPrisma.rosterSchedule.create).not.toHaveBeenCalled();
  });
});
