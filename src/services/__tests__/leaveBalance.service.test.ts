/**
 * LeaveBalanceService tests
 *
 * Focus areas (per the 2026-05-02 code review — leave balance is
 * compliance-critical and had zero coverage):
 *
 *   1. Carry-over math in initializeYear — wrong numbers here mean
 *      employees lose or gain leave they shouldn't have.
 *   2. handleLeaveDecision side effects — wrong increments here mean
 *      approved leave doesn't deduct, or rejection drives counts negative.
 *   3. adjustBalance cross-org safety — admin from org A must never be
 *      able to mutate a balance belonging to org B.
 *   4. Feature-flag honoring — when leaveBalanceEnabled is false the
 *      service must be a no-op rather than partially write data.
 *
 * Strategy: prisma is fully mocked. These are unit tests of the
 * service's logic, not integration tests of the schema. A separate
 * integration suite (out of scope here) should exercise the actual
 * unique constraint, transaction isolation, etc.
 */

// Mock Prisma BEFORE importing the service.
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    leaveBalance: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    orgMembership: {
      findMany: jest.fn(),
    },
    leave: {
      findUnique: jest.fn(),
    },
  },
}));

import { leaveBalanceService } from '../leaveBalance.service';
import { NotFoundError, ValidationError } from '../../lib/errors';

// ── Helpers ───────────────────────────────────────────────────

const ORG_ID = 'org-1';
const MEMBERSHIP_ID = 'mem-1';
const BS_YEAR = 2082;

// Default org policy used across most tests
const DEFAULT_ORG_POLICY = {
  leaveBalanceEnabled: true,
  annualLeaveEntitlement: 18,
  sickLeaveEntitlement: 12,
  casualLeaveEntitlement: 7,
};

/** Build a fully-formed LeaveBalance object — every field zero unless overridden. */
function makeBalance(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bal-1',
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    bsYear: BS_YEAR,
    annualEntitlement: 18,
    sickEntitlement: 12,
    casualEntitlement: 7,
    annualCarriedOver: 0,
    sickCarriedOver: 0,
    casualCarriedOver: 0,
    annualUsed: 0,
    sickUsed: 0,
    casualUsed: 0,
    initializedBy: null,
    initializedAt: null,
    lastAdjustedBy: null,
    lastAdjustedAt: null,
    adjustmentNote: null,
    ...overrides,
  };
}

let mockPrisma: any;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
});

// ── withAvailable (via getOrgBalances) ────────────────────────

describe('withAvailable computed fields', () => {
  it('computes available = entitlement + carriedOver - used', async () => {
    mockPrisma.leaveBalance.findMany.mockResolvedValue([
      makeBalance({
        annualEntitlement: 18,
        annualCarriedOver: 5,
        annualUsed: 7,
        sickEntitlement: 12,
        sickUsed: 3,
        casualEntitlement: 7,
        casualUsed: 7,
        membership: { user: { firstName: 'A', lastName: 'B' } },
      }),
    ]);

    const result = await leaveBalanceService.getOrgBalances(ORG_ID, BS_YEAR);

    expect(result[0].annualAvailable).toBe(16); // 18 + 5 - 7
    expect(result[0].sickAvailable).toBe(9); // 12 + 0 - 3
    expect(result[0].casualAvailable).toBe(0); // 7 + 0 - 7
  });

  it('floors available at 0 when used exceeds entitlement+carriedOver', async () => {
    // Defensive: if balance was over-deducted somehow, don't show negative.
    mockPrisma.leaveBalance.findMany.mockResolvedValue([
      makeBalance({
        annualEntitlement: 5,
        annualCarriedOver: 0,
        annualUsed: 10,
        membership: { user: { firstName: 'A', lastName: 'B' } },
      }),
    ]);

    const result = await leaveBalanceService.getOrgBalances(ORG_ID, BS_YEAR);
    expect(result[0].annualAvailable).toBe(0);
  });
});

// ── getMyBalance ──────────────────────────────────────────────

describe('getMyBalance', () => {
  it('returns null when leaveBalanceEnabled is false', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ leaveBalanceEnabled: false });

    const result = await leaveBalanceService.getMyBalance(MEMBERSHIP_ID, ORG_ID, BS_YEAR);

    expect(result).toBeNull();
    expect(mockPrisma.leaveBalance.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when no balance record exists', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ leaveBalanceEnabled: true });
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(null);

    const result = await leaveBalanceService.getMyBalance(MEMBERSHIP_ID, ORG_ID, BS_YEAR);
    expect(result).toBeNull();
  });

  it('returns balance with computed available fields', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ leaveBalanceEnabled: true });
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(
      makeBalance({ annualEntitlement: 18, annualUsed: 4 })
    );

    const result = await leaveBalanceService.getMyBalance(MEMBERSHIP_ID, ORG_ID, BS_YEAR);
    expect(result?.annualAvailable).toBe(14);
  });
});

// ── initializeYear ────────────────────────────────────────────

describe('initializeYear', () => {
  beforeEach(() => {
    // Default: empty memberships, no existing balances, no prev year
    mockPrisma.orgMembership.findMany.mockResolvedValue([]);
    mockPrisma.leaveBalance.findMany.mockResolvedValue([]);
    mockPrisma.leaveBalance.createMany.mockResolvedValue({ count: 0 });
  });

  it('throws NotFoundError when organization is missing', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin-user')
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when leaveBalanceEnabled is false', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      ...DEFAULT_ORG_POLICY,
      leaveBalanceEnabled: false,
    });

    await expect(
      leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin-user')
    ).rejects.toThrow(ValidationError);
  });

  it('first-year init: zero carry-over, fresh entitlements', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: MEMBERSHIP_ID, employeeId: 'EMP-001', user: { firstName: 'Alice', lastName: 'A' } },
    ]);
    // No prev year, no existing
    mockPrisma.leaveBalance.findMany.mockResolvedValue([]);

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin');

    expect(result.created).toBe(1);
    expect(result.preview[0]).toMatchObject({
      annualCarriedOver: 0,
      sickCarriedOver: 0,
      casualCarriedOver: 0,
      annualAvailable: 18,
      sickAvailable: 12,
      casualAvailable: 7,
      cappedWarning: false,
      skipped: false,
    });
  });

  it('carries over unused leave from previous year', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: MEMBERSHIP_ID, employeeId: 'EMP-001', user: { firstName: 'A', lastName: 'B' } },
    ]);
    // findMany is called twice: once for existing (this year), once for prev year.
    // First call → existing balances; second call → prev year balances.
    mockPrisma.leaveBalance.findMany
      .mockResolvedValueOnce([]) // existing this year — none
      .mockResolvedValueOnce([
        makeBalance({
          annualEntitlement: 18,
          annualCarriedOver: 0,
          annualUsed: 8, // 10 unused → carry over 10
          sickEntitlement: 12,
          sickUsed: 2, // 10 unused
          casualEntitlement: 7,
          casualUsed: 0, // 7 unused
        }),
      ]);

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin');

    expect(result.preview[0]).toMatchObject({
      annualCarriedOver: 10,
      sickCarriedOver: 10,
      casualCarriedOver: 7,
      annualAvailable: 28, // 18 + 10
      sickAvailable: 22, // 12 + 10
      casualAvailable: 14, // 7 + 7
      cappedWarning: false,
    });
  });

  it('caps annual carry-over at legal limit and flags cappedWarning', async () => {
    // Legal cap = 90 days total. If this year's entitlement is 18, max
    // carry-over = 72. Anything above is dropped + cappedWarning fires.
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: MEMBERSHIP_ID, employeeId: 'EMP-001', user: { firstName: 'A', lastName: 'B' } },
    ]);
    mockPrisma.leaveBalance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeBalance({
          annualEntitlement: 18,
          annualCarriedOver: 80, // big prior balance
          annualUsed: 0, // all 98 unused
        }),
      ]);

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin');

    // 18 + 80 - 0 = 98 unused. Cap at 90 - 18 = 72.
    expect(result.preview[0].annualCarriedOver).toBe(72);
    expect(result.preview[0].cappedWarning).toBe(true);
  });

  it('floors carry-over at 0 when previous year was overdrawn', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: MEMBERSHIP_ID, employeeId: 'EMP-001', user: { firstName: 'A', lastName: 'B' } },
    ]);
    mockPrisma.leaveBalance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeBalance({
          annualEntitlement: 18,
          annualCarriedOver: 0,
          annualUsed: 25, // overdrawn by 7 (admin override scenario)
        }),
      ]);

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin');

    // -7 unused → carry-over must be 0, not negative
    expect(result.preview[0].annualCarriedOver).toBe(0);
  });

  it('dryRun returns preview without writing', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: MEMBERSHIP_ID, employeeId: 'EMP-001', user: { firstName: 'A', lastName: 'B' } },
    ]);

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin', true);

    expect(result.preview).toHaveLength(1);
    expect(result.created).toBe(0);
    expect(mockPrisma.leaveBalance.createMany).not.toHaveBeenCalled();
  });

  it('skips employees who already have a balance for the year', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(DEFAULT_ORG_POLICY);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { id: 'mem-1', employeeId: 'EMP-001', user: { firstName: 'A', lastName: 'B' } },
      { id: 'mem-2', employeeId: 'EMP-002', user: { firstName: 'C', lastName: 'D' } },
    ]);
    mockPrisma.leaveBalance.findMany
      .mockResolvedValueOnce([{ membershipId: 'mem-1' }]) // mem-1 already initialized
      .mockResolvedValueOnce([]); // no prev year

    const result = await leaveBalanceService.initializeYear(ORG_ID, BS_YEAR, 'admin');

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    // Only the un-initialized one is in the createMany payload
    const createArgs = mockPrisma.leaveBalance.createMany.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(1);
    expect(createArgs.data[0].membershipId).toBe('mem-2');
  });
});

// ── handleLeaveDecision ───────────────────────────────────────

describe('handleLeaveDecision', () => {
  // Common: 5-day leave (Mon-Fri inclusive)
  const startDate = new Date('2025-01-06T00:00:00Z');
  const endDate = new Date('2025-01-10T00:00:00Z'); // 4 days apart → 5 days inclusive

  beforeEach(() => {
    mockPrisma.organization.findUnique.mockResolvedValue({ leaveBalanceEnabled: true });
    mockPrisma.leave.findUnique.mockResolvedValue({ bsStartYear: BS_YEAR });
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(makeBalance());
    mockPrisma.leaveBalance.update.mockResolvedValue(makeBalance());
  });

  it('skips untracked leave types (UNPAID)', async () => {
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'UNPAID', startDate, endDate, 'APPROVED'
    );
    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
    // Skipped early — should not even check the org
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('skips untracked leave types (MATERNITY)', async () => {
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'MATERNITY', startDate, endDate, 'APPROVED'
    );
    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('skips when leaveBalanceEnabled is false', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ leaveBalanceEnabled: false });
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'APPROVED'
    );
    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('skips when leave has no bsStartYear', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue({ bsStartYear: null });
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'APPROVED'
    );
    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('skips when no balance record exists (employee joined mid-year)', async () => {
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(null);
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'APPROVED'
    );
    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('APPROVED: increments by inclusive day count (5 days for Mon-Fri)', async () => {
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'APPROVED'
    );

    expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { membershipId_bsYear: { membershipId: MEMBERSHIP_ID, bsYear: BS_YEAR } },
      data: { annualUsed: { increment: 5 } },
    });
  });

  it('APPROVED: same-day leave counts as 1 day', async () => {
    const sameDay = new Date('2025-01-06T00:00:00Z');
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'SICK', sameDay, sameDay, 'APPROVED'
    );

    expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { membershipId_bsYear: { membershipId: MEMBERSHIP_ID, bsYear: BS_YEAR } },
      data: { sickUsed: { increment: 1 } },
    });
  });

  it('REJECTED: refunds days from existing used balance', async () => {
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(makeBalance({ annualUsed: 10 }));

    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'REJECTED'
    );

    expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { membershipId_bsYear: { membershipId: MEMBERSHIP_ID, bsYear: BS_YEAR } },
      data: { annualUsed: 5 }, // 10 - 5
    });
  });

  it('REJECTED: never produces a negative used count', async () => {
    // Edge: refunding more days than were used (data drift, manual adjustment)
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(makeBalance({ annualUsed: 2 }));

    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, 'ANNUAL', startDate, endDate, 'REJECTED'
    );

    expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { membershipId_bsYear: { membershipId: MEMBERSHIP_ID, bsYear: BS_YEAR } },
      data: { annualUsed: 0 }, // floored, not -3
    });
  });

  it.each([
    ['ANNUAL', 'annualUsed'],
    ['SICK', 'sickUsed'],
    ['CASUAL', 'casualUsed'],
  ])('maps leave type %s → %s field', async (leaveType, expectedField) => {
    await leaveBalanceService.handleLeaveDecision(
      'leave-1', ORG_ID, MEMBERSHIP_ID, leaveType, startDate, endDate, 'APPROVED'
    );

    const updateCall = mockPrisma.leaveBalance.update.mock.calls[0][0];
    expect(updateCall.data).toHaveProperty(expectedField);
  });
});

// ── adjustBalance ─────────────────────────────────────────────

describe('adjustBalance', () => {
  it('rejects empty note', async () => {
    await expect(
      leaveBalanceService.adjustBalance(ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, '', 'admin')
    ).rejects.toThrow(ValidationError);
  });

  it('rejects note shorter than 3 characters', async () => {
    await expect(
      leaveBalanceService.adjustBalance(ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, 'no', 'admin')
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when balance does not exist', async () => {
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(null);

    await expect(
      leaveBalanceService.adjustBalance(
        ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, 'bonus leave granted', 'admin'
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when balance belongs to a different org (cross-org safety)', async () => {
    // The balance exists but is owned by another organization. Admin from
    // ORG_ID must not be able to mutate it.
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(
      makeBalance({ organizationId: 'other-org' })
    );

    await expect(
      leaveBalanceService.adjustBalance(
        ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, 'bonus leave granted', 'admin'
      )
    ).rejects.toThrow(NotFoundError);

    expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('writes audit fields (lastAdjustedBy, lastAdjustedAt, adjustmentNote)', async () => {
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(makeBalance());
    mockPrisma.leaveBalance.update.mockResolvedValue(makeBalance({ annualEntitlement: 20 }));

    await leaveBalanceService.adjustBalance(
      ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, '  bonus leave granted  ', 'admin-1'
    );

    const updateArg = mockPrisma.leaveBalance.update.mock.calls[0][0];
    expect(updateArg.data.annualEntitlement).toBe(20);
    expect(updateArg.data.lastAdjustedBy).toBe('admin-1');
    expect(updateArg.data.adjustmentNote).toBe('bonus leave granted'); // trimmed
    expect(updateArg.data.lastAdjustedAt).toBeInstanceOf(Date);
  });

  it('returns balance with computed available fields', async () => {
    mockPrisma.leaveBalance.findUnique.mockResolvedValue(makeBalance());
    mockPrisma.leaveBalance.update.mockResolvedValue(
      makeBalance({ annualEntitlement: 20, annualUsed: 5 })
    );

    const result = await leaveBalanceService.adjustBalance(
      ORG_ID, MEMBERSHIP_ID, BS_YEAR, { annualEntitlement: 20 }, 'bonus', 'admin'
    );

    expect(result.annualAvailable).toBe(15); // 20 + 0 - 5
  });
});
