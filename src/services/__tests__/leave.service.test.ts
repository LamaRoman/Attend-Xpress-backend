/**
 * LeaveService tests
 *
 * Per the 2026-05-02 code review (no coverage on this service). Focus:
 *
 *   1. requestLeave validation — ConflictError on overlapping requests
 *      is the load-bearing piece (employees double-booking PTO).
 *   2. updateLeaveStatus state machine — non-PENDING → ValidationError,
 *      cross-org access treated as NotFound (not 403, to avoid leaking
 *      whether a leave exists for an org the caller can't see).
 *   3. The integration point with LeaveBalanceService.handleLeaveDecision —
 *      verifying the call is fired with the right arguments. If someone
 *      refactors and accidentally drops it, this is the regression catcher.
 *   4. cancelLeave cross-employee safety — same NotFound-not-403 idea.
 *   5. getLeaveSummary clipping — leaves that span outside the requested
 *      window are correctly clipped to the window for payroll/reports.
 *
 * Strategy: prisma, emailService, and leaveBalanceService are all mocked.
 * Real adToBS / nepali-date is used (deterministic pure functions).
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
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../../lib/errors';

// ── Helpers ───────────────────────────────────────────────────

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const MEMBERSHIP_ID = 'mem-1';
const OTHER_MEMBERSHIP_ID = 'mem-2';
const USER_ID = 'user-1';
const LEAVE_ID = 'leave-1';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: USER_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    role: 'EMPLOYEE',
    ...overrides,
  } as any;
}

function makeLeave(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LEAVE_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    startDate: new Date('2025-06-01T00:00:00Z'),
    endDate: new Date('2025-06-05T00:00:00Z'),
    reason: 'family event',
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
      employeeId: 'EMP-001',
      user: {
        firstName: 'Alice',
        lastName: 'A',
        email: 'alice@example.com',
      },
    },
    approver: null,
    ...overrides,
  };
}

let mockPrisma: any;
let mockEmail: any;
let mockBalance: any;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockEmail = require('../email.service').emailService;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockBalance = require('../leaveBalance.service').leaveBalanceService;
});

// ── requestLeave ───────────────────────────────────────────────

describe('requestLeave', () => {
  const validInput = {
    startDate: new Date('2025-06-01T00:00:00Z'),
    endDate: new Date('2025-06-05T00:00:00Z'),
    reason: 'family event',
    type: 'ANNUAL',
  } as any;

  beforeEach(() => {
    mockPrisma.leave.findFirst.mockResolvedValue(null); // no overlap
    mockPrisma.leave.create.mockResolvedValue(makeLeave());
    mockPrisma.orgMembership.findMany.mockResolvedValue([]);
    mockPrisma.organization.findUnique.mockResolvedValue({ name: 'TestCo' });
  });

  it('throws when user has no active membership', async () => {
    await expect(
      leaveService.requestLeave(validInput, makeUser({ membershipId: null }))
    ).rejects.toThrow(ValidationError);
    expect(mockPrisma.leave.create).not.toHaveBeenCalled();
  });

  it('throws when end date is before start date', async () => {
    const bad = {
      ...validInput,
      startDate: new Date('2025-06-10T00:00:00Z'),
      endDate: new Date('2025-06-05T00:00:00Z'),
    };
    await expect(
      leaveService.requestLeave(bad, makeUser())
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError when an overlapping PENDING leave exists', async () => {
    mockPrisma.leave.findFirst.mockResolvedValue(makeLeave({ status: 'PENDING' }));

    await expect(
      leaveService.requestLeave(validInput, makeUser())
    ).rejects.toThrow(ConflictError);
    expect(mockPrisma.leave.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when an overlapping APPROVED leave exists', async () => {
    mockPrisma.leave.findFirst.mockResolvedValue(makeLeave({ status: 'APPROVED' }));

    await expect(
      leaveService.requestLeave(validInput, makeUser())
    ).rejects.toThrow(ConflictError);
  });

  it('creates leave with PENDING status and BS calendar fields populated', async () => {
    await leaveService.requestLeave(validInput, makeUser());

    expect(mockPrisma.leave.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.leave.create.mock.calls[0][0];
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.membershipId).toBe(MEMBERSHIP_ID);
    expect(arg.data.organizationId).toBe(ORG_ID);
    // adToBS should have set BS fields — exact values come from the
    // real nepali-date library, we just assert they're populated.
    expect(typeof arg.data.bsStartYear).toBe('number');
    expect(typeof arg.data.bsEndYear).toBe('number');
  });

  it('returns leave plus durationDays (inclusive)', async () => {
    const result = await leaveService.requestLeave(validInput, makeUser());
    expect(result.durationDays).toBe(5); // Jun 1 → Jun 5 inclusive
  });

  it('does not throw when admin notification email fails', async () => {
    // Email failures must be isolated — leave request creation is the
    // primary action, email is best-effort.
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { user: { email: 'admin@example.com', firstName: 'Admin' } },
    ]);
    mockEmail.sendLeaveRequestNotification.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      leaveService.requestLeave(validInput, makeUser())
    ).resolves.toBeDefined();
  });

  it('does not throw when admin lookup fails entirely', async () => {
    mockPrisma.orgMembership.findMany.mockRejectedValue(new Error('DB hiccup'));

    await expect(
      leaveService.requestLeave(validInput, makeUser())
    ).resolves.toBeDefined();
    expect(mockPrisma.leave.create).toHaveBeenCalled(); // primary action still ran
  });
});

// ── updateLeaveStatus ──────────────────────────────────────────

describe('updateLeaveStatus', () => {
  beforeEach(() => {
    mockPrisma.leave.update.mockResolvedValue({
      ...makeLeave({ status: 'APPROVED' }),
      approver: { firstName: 'Admin', lastName: 'A' },
    });
  });

  it('throws NotFoundError when leave does not exist', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(null);

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).rejects.toThrow(NotFoundError);
  });

  it('returns NotFoundError (not 403) when admin from another org tries to approve', async () => {
    // Cross-org access must look identical to "not found" to avoid
    // leaking whether a leave exists in an org the caller can't see.
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ organizationId: OTHER_ORG_ID }));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).rejects.toThrow(NotFoundError);
    expect(mockPrisma.leave.update).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN to approve a leave from any org', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ organizationId: OTHER_ORG_ID }));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'SUPER_ADMIN' }))
    ).resolves.toBeDefined();
    expect(mockPrisma.leave.update).toHaveBeenCalled();
  });

  it('rejects double-approval (status already APPROVED)', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ status: 'APPROVED' }));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects approving a previously-rejected leave', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ status: 'REJECTED' }));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).rejects.toThrow(ValidationError);
  });

  it('writes status, approvedBy, approvedAt on approval', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave());

    await leaveService.updateLeaveStatus(
      LEAVE_ID,
      'APPROVED',
      makeUser({ role: 'ORG_ADMIN' })
    );

    const updateArg = mockPrisma.leave.update.mock.calls[0][0];
    expect(updateArg.data).toMatchObject({
      status: 'APPROVED',
      approvedBy: USER_ID,
    });
    expect(updateArg.data.approvedAt).toBeInstanceOf(Date);
  });

  it('persists rejectionMessage on rejection when supplied', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave());

    await leaveService.updateLeaveStatus(
      LEAVE_ID,
      'REJECTED',
      makeUser({ role: 'ORG_ADMIN' }),
      'Insufficient leave balance'
    );

    const updateArg = mockPrisma.leave.update.mock.calls[0][0];
    expect(updateArg.data.rejectionMessage).toBe('Insufficient leave balance');
  });

  it('calls leaveBalanceService.handleLeaveDecision with the right arguments', async () => {
    // This is the integration point with the service we tested in the
    // previous file — if a refactor accidentally drops this call,
    // approved leave silently doesn't deduct from the balance. This
    // test is the regression catcher.
    const leave = makeLeave({
      type: 'SICK',
      startDate: new Date('2025-06-10T00:00:00Z'),
      endDate: new Date('2025-06-12T00:00:00Z'),
    });
    mockPrisma.leave.findUnique.mockResolvedValue(leave);

    await leaveService.updateLeaveStatus(
      LEAVE_ID,
      'APPROVED',
      makeUser({ role: 'ORG_ADMIN' })
    );

    expect(mockBalance.handleLeaveDecision).toHaveBeenCalledWith(
      LEAVE_ID,
      ORG_ID,
      MEMBERSHIP_ID,
      'SICK',
      leave.startDate,
      leave.endDate,
      'APPROVED'
    );
  });

  it('does not block approval when handleLeaveDecision rejects', async () => {
    // Fire-and-forget contract — leave approval must succeed even if
    // the balance hook fails. (The .catch() in source guarantees this.)
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave());
    mockBalance.handleLeaveDecision.mockRejectedValueOnce(new Error('balance update failed'));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).resolves.toBeDefined();
  });

  it('does not block approval when employee notification email fails', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave());
    mockEmail.sendLeaveDecisionNotification.mockRejectedValueOnce(new Error('SMTP'));

    await expect(
      leaveService.updateLeaveStatus(LEAVE_ID, 'APPROVED', makeUser({ role: 'ORG_ADMIN' }))
    ).resolves.toBeDefined();
  });
});

// ── cancelLeave ───────────────────────────────────────────────

describe('cancelLeave', () => {
  it('throws NotFoundError when leave does not exist', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(null);

    await expect(
      leaveService.cancelLeave(LEAVE_ID, makeUser())
    ).rejects.toThrow(NotFoundError);
  });

  it('returns NotFoundError (not 403) when another employee tries to cancel', async () => {
    // Cross-employee access must not leak existence.
    mockPrisma.leave.findUnique.mockResolvedValue(
      makeLeave({ membershipId: OTHER_MEMBERSHIP_ID })
    );

    await expect(
      leaveService.cancelLeave(LEAVE_ID, makeUser())
    ).rejects.toThrow(NotFoundError);
    expect(mockPrisma.leave.delete).not.toHaveBeenCalled();
  });

  it('rejects cancelling an already-approved leave', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ status: 'APPROVED' }));

    await expect(
      leaveService.cancelLeave(LEAVE_ID, makeUser())
    ).rejects.toThrow(ValidationError);
    expect(mockPrisma.leave.delete).not.toHaveBeenCalled();
  });

  it('deletes a PENDING leave owned by the caller', async () => {
    mockPrisma.leave.findUnique.mockResolvedValue(makeLeave({ status: 'PENDING' }));
    mockPrisma.leave.delete.mockResolvedValue(undefined);

    const result = await leaveService.cancelLeave(LEAVE_ID, makeUser());

    expect(mockPrisma.leave.delete).toHaveBeenCalledWith({ where: { id: LEAVE_ID } });
    expect(result.message).toBeDefined();
  });
});

// ── getLeaveSummary ───────────────────────────────────────────

describe('getLeaveSummary', () => {
  const windowStart = new Date('2025-06-01T00:00:00Z');
  const windowEnd = new Date('2025-06-30T00:00:00Z');

  it('returns zero totals when no approved leaves match', async () => {
    mockPrisma.leave.findMany.mockResolvedValue([]);

    const result = await leaveService.getLeaveSummary(MEMBERSHIP_ID, windowStart, windowEnd);
    expect(result.totalDays).toBe(0);
    expect(result.byType).toEqual({});
  });

  it('aggregates inclusive day counts by leave type', async () => {
    mockPrisma.leave.findMany.mockResolvedValue([
      makeLeave({
        type: 'ANNUAL',
        startDate: new Date('2025-06-02T00:00:00Z'),
        endDate: new Date('2025-06-04T00:00:00Z'), // 3 days
      }),
      makeLeave({
        type: 'SICK',
        startDate: new Date('2025-06-10T00:00:00Z'),
        endDate: new Date('2025-06-10T00:00:00Z'), // 1 day
      }),
      makeLeave({
        type: 'ANNUAL',
        startDate: new Date('2025-06-20T00:00:00Z'),
        endDate: new Date('2025-06-22T00:00:00Z'), // 3 days
      }),
    ]);

    const result = await leaveService.getLeaveSummary(MEMBERSHIP_ID, windowStart, windowEnd);

    expect(result.totalDays).toBe(7);
    expect(result.byType).toEqual({ ANNUAL: 6, SICK: 1 });
  });

  it('clips a leave that starts before the window', async () => {
    // Leave May 28 → Jun 03; window Jun 01 → Jun 30.
    // Should count Jun 1 → Jun 3 = 3 days, not the full leave duration.
    mockPrisma.leave.findMany.mockResolvedValue([
      makeLeave({
        type: 'ANNUAL',
        startDate: new Date('2025-05-28T00:00:00Z'),
        endDate: new Date('2025-06-03T00:00:00Z'),
      }),
    ]);

    const result = await leaveService.getLeaveSummary(MEMBERSHIP_ID, windowStart, windowEnd);
    expect(result.totalDays).toBe(3);
  });

  it('clips a leave that ends after the window', async () => {
    // Leave Jun 28 → Jul 03; window Jun 01 → Jun 30.
    // Should count Jun 28 → Jun 30 = 3 days.
    mockPrisma.leave.findMany.mockResolvedValue([
      makeLeave({
        type: 'ANNUAL',
        startDate: new Date('2025-06-28T00:00:00Z'),
        endDate: new Date('2025-07-03T00:00:00Z'),
      }),
    ]);

    const result = await leaveService.getLeaveSummary(MEMBERSHIP_ID, windowStart, windowEnd);
    expect(result.totalDays).toBe(3);
  });

  it('queries only APPROVED leaves', async () => {
    mockPrisma.leave.findMany.mockResolvedValue([]);
    await leaveService.getLeaveSummary(MEMBERSHIP_ID, windowStart, windowEnd);

    const queryArg = mockPrisma.leave.findMany.mock.calls[0][0];
    expect(queryArg.where.status).toBe('APPROVED');
  });
});
