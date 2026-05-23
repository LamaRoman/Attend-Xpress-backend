/**
 * report.service — branch-scope tests (Phase 8a / 8b)
 *
 * Focused on the resolveBranchFilter + branchWhere call sites added in
 * Phase 8a. Two Prisma queries are constructed in getDailyReport:
 *
 *   membershipWhere — uses branchWhere(scope) spread (direct branchId key)
 *   attendanceWhere — uses conditional { membership: { branchId } } shape
 *
 * Tests verify both where-clause shapes for three caller roles:
 *   BRANCH_ADMIN     → both filtered by their locked branchId
 *   ORG_ADMIN + arg  → both filtered by the explicit branchId
 *   ORG_ADMIN no arg → neither filtered (org-wide)
 *
 * The weekly and monthly report methods share the same resolveBranchFilter
 * pattern; covering getDailyReport is sufficient to verify the abstraction.
 */

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    orgMembership: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  },
}));

import { ReportService } from '../report.service';

// ── Constants ──────────────────────────────────────────────────────────────

const ORG_ID   = 'org-1';
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const TODAY    = new Date('2025-06-15T00:00:00Z');

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
let reportService: ReportService;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
  reportService = new ReportService();

  // Default stubs — return minimal valid shapes so the service doesn't throw
  // during the data-assembly step after the Prisma calls we're inspecting.
  mockPrisma.orgMembership.findMany.mockResolvedValue([]);
  mockPrisma.attendanceRecord.findMany.mockResolvedValue([]);
  mockPrisma.organization.findUnique.mockResolvedValue(null);
});

// ── getDailyReport — branch-scope ─────────────────────────────────────────

describe('getDailyReport — branch-scope (Phase 8a / 8b)', () => {
  it('BRANCH_ADMIN: branchId appears in membershipWhere via branchWhere spread', async () => {
    await reportService.getDailyReport(
      TODAY,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
    );

    const membershipArgs = mockPrisma.orgMembership.findMany.mock.calls[0][0];
    // branchWhere({ branchId: BRANCH_A }) spreads { branchId: BRANCH_A } directly.
    expect(membershipArgs.where.branchId).toBe(BRANCH_A);
  });

  it('BRANCH_ADMIN: attendance query uses { membership: { branchId } } shape', async () => {
    await reportService.getDailyReport(
      TODAY,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
    );

    const attendanceArgs = mockPrisma.attendanceRecord.findMany.mock.calls[0][0];
    // AttendanceRecord has no direct branchId — filter goes via membership relation.
    expect(attendanceArgs.where.membership).toEqual({ branchId: BRANCH_A });
  });

  it('ORG_ADMIN with explicit branchId: both queries are narrowed (voluntary narrowing)', async () => {
    await reportService.getDailyReport(
      TODAY,
      makeUser({ role: 'ORG_ADMIN' }),
      BRANCH_B,
    );

    const membershipArgs = mockPrisma.orgMembership.findMany.mock.calls[0][0];
    const attendanceArgs = mockPrisma.attendanceRecord.findMany.mock.calls[0][0];

    expect(membershipArgs.where.branchId).toBe(BRANCH_B);
    expect(attendanceArgs.where.membership).toEqual({ branchId: BRANCH_B });
  });

  it('ORG_ADMIN without branchId: no branch filter on either query (org-wide view)', async () => {
    await reportService.getDailyReport(
      TODAY,
      makeUser({ role: 'ORG_ADMIN' }),
      // no branchIdFilter argument
    );

    const membershipArgs = mockPrisma.orgMembership.findMany.mock.calls[0][0];
    const attendanceArgs = mockPrisma.attendanceRecord.findMany.mock.calls[0][0];

    // branchWhere({ branchId: null }) returns {}, so branchId key must be absent.
    expect(membershipArgs.where.branchId).toBeUndefined();
    expect(attendanceArgs.where.membership).toBeUndefined();
  });

  it('BRANCH_ADMIN cannot spoof a different branch via the branchIdFilter arg', async () => {
    // Even if the route passed a different branchId, resolveBranchFilter
    // ignores it for BRANCH_ADMIN and returns their locked branch.
    await reportService.getDailyReport(
      TODAY,
      makeUser({ role: 'BRANCH_ADMIN', branchId: BRANCH_A }),
      BRANCH_B, // attempted spoof
    );

    const membershipArgs = mockPrisma.orgMembership.findMany.mock.calls[0][0];
    expect(membershipArgs.where.branchId).toBe(BRANCH_A); // locked, not spoofed
  });
});
