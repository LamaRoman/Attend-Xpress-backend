// Holiday cross-org isolation tests
//
// Locks in the fix from PR #32 ("security(holidays): scope update/delete
// by organizationId, gate national holidays"). Before that PR:
//
//   H-1 (Medium): ORG_ADMIN in Org A could toggle/delete any Org B
//                 holiday by UUID, because updateHoliday/deleteHoliday
//                 ran plain prisma.holiday.update/delete({ where: { id } })
//                 with no org scope.
//   H-2 (High):   Any ORG_ADMIN could mutate *national* holidays
//                 (organizationId == null) platform-wide, affecting
//                 payroll working-day calculations across every tenant.
//                 National holiday UUIDs are freely exposed to any
//                 authenticated admin via GET /holidays/master.
//
// These tests assert that the post-fix behavior stays in place:
//
//   - ORG_ADMIN in Org A -> PUT/DELETE a holiday belonging to Org B -> 404
//   - ORG_ADMIN in any org -> PUT/DELETE a national holiday -> 404
//   - ORG_ADMIN -> PUT/DELETE a holiday in their OWN org -> succeeds
//   - SUPER_ADMIN -> PUT/DELETE any holiday (org-scoped or national) -> succeeds
//   - Any role -> PUT/DELETE a non-existent UUID -> 404
//
// Cross-org misses must throw NotFoundError (404), not AuthorizationError
// (403). Identical error shape on "not in your org" vs "does not exist"
// is the anti-enumeration property — a probing attacker cannot distinguish
// the two cases.

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    holiday: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// HolidayService constructs a NodeCache at module scope. The paths we
// exercise here do not read or write the cache, but stubbing it keeps
// test output clean and would catch a future regression that started
// caching around the mutation path.
jest.mock('node-cache', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    flushAll: jest.fn(),
  }));
});

import { HolidayService } from '@/services/holiday.service';
import { NotFoundError } from '@/lib/errors';
import type { JWTPayload } from '@/lib/jwt';

describe('HolidayService — cross-org isolation (PR #32 regression guard)', () => {
  let service: HolidayService;
  let mockPrisma: any;

  // Fixture UUIDs. Real v4s so they look like the real thing in logs.
  // The service does not validate UUID format, so any unique strings
  // would work — this is for greppability.
  const ORG_A_ID = '11111111-1111-4111-8111-111111111111';
  const ORG_B_ID = '22222222-2222-4222-8222-222222222222';

  const HOLIDAY_IN_ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const HOLIDAY_IN_ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NATIONAL_HOLIDAY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const NONEXISTENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  // JWTPayload shape matches src/lib/jwt.ts exactly.
  const orgAAdmin: JWTPayload = {
    userId: 'user-a',
    id: 'user-a',
    email: 'admin@orga.test',
    role: 'ORG_ADMIN',
    organizationId: ORG_A_ID,
    membershipId: 'membership-a',
    branchId: null,
  };

  const orgBAdmin: JWTPayload = {
    userId: 'user-b',
    id: 'user-b',
    email: 'admin@orgb.test',
    role: 'ORG_ADMIN',
    organizationId: ORG_B_ID,
    membershipId: 'membership-b',
    branchId: null,
  };

  const superAdmin: JWTPayload = {
    userId: 'user-super',
    id: 'user-super',
    email: 'super@platform.test',
    role: 'SUPER_ADMIN',
    organizationId: null,
    membershipId: null,
    branchId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = require('@/lib/prisma').default;
    service = new HolidayService();

    // Default lookup: the service only selects { organizationId }, so
    // the mock returns just that shape. Individual tests override as
    // needed.
    mockPrisma.holiday.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === HOLIDAY_IN_ORG_A) return Promise.resolve({ organizationId: ORG_A_ID });
      if (where.id === HOLIDAY_IN_ORG_B) return Promise.resolve({ organizationId: ORG_B_ID });
      if (where.id === NATIONAL_HOLIDAY) return Promise.resolve({ organizationId: null });
      return Promise.resolve(null);
    });

    mockPrisma.holiday.update.mockResolvedValue({ id: 'updated', isActive: true });
    mockPrisma.holiday.delete.mockResolvedValue({ id: 'deleted' });
  });

  // ==========================================================================
  // updateHoliday
  // ==========================================================================
  describe('updateHoliday', () => {
    it('allows ORG_ADMIN to update a holiday in their own org', async () => {
      await expect(
        service.updateHoliday(HOLIDAY_IN_ORG_A, false, orgAAdmin),
      ).resolves.toBeDefined();

      expect(mockPrisma.holiday.update).toHaveBeenCalledWith({
        where: { id: HOLIDAY_IN_ORG_A },
        data: { isActive: false },
      });
    });

    it("rejects ORG_ADMIN trying to update another org's holiday with NotFoundError", async () => {
      await expect(
        service.updateHoliday(HOLIDAY_IN_ORG_B, false, orgAAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      // Critical: the DB write must not have fired. The fix's whole
      // point is that the scope check happens BEFORE the mutation.
      expect(mockPrisma.holiday.update).not.toHaveBeenCalled();
    });

    it('rejects ORG_ADMIN trying to update a national holiday with NotFoundError (H-2)', async () => {
      // H-2: a regression here would let any ORG_ADMIN disable or
      // toggle Dashain / Tihar / etc. platform-wide via the freely
      // exposed UUIDs from GET /holidays/master.
      await expect(
        service.updateHoliday(NATIONAL_HOLIDAY, false, orgAAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockPrisma.holiday.update).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to update a national holiday', async () => {
      await expect(
        service.updateHoliday(NATIONAL_HOLIDAY, false, superAdmin),
      ).resolves.toBeDefined();

      expect(mockPrisma.holiday.update).toHaveBeenCalledWith({
        where: { id: NATIONAL_HOLIDAY },
        data: { isActive: false },
      });
    });

    it('allows SUPER_ADMIN to update any org-scoped holiday', async () => {
      // SUPER_ADMIN has no organizationId, so the same-org branch in
      // the service cannot match them. The fix guards this via the
      // explicit role === 'SUPER_ADMIN' check — this pins that.
      await expect(
        service.updateHoliday(HOLIDAY_IN_ORG_A, true, superAdmin),
      ).resolves.toBeDefined();

      expect(mockPrisma.holiday.update).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundError for a non-existent holiday UUID', async () => {
      await expect(
        service.updateHoliday(NONEXISTENT_ID, true, orgAAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockPrisma.holiday.update).not.toHaveBeenCalled();
    });

    it('makes cross-org miss indistinguishable from true not-found (anti-enumeration)', async () => {
      // An attacker probing UUIDs must not be able to tell "holiday
      // exists in another org" from "holiday does not exist". Same
      // error class, same status, same message.
      const realMiss = await service
        .updateHoliday(NONEXISTENT_ID, true, orgAAdmin)
        .catch((e: any) => e);
      const crossOrgMiss = await service
        .updateHoliday(HOLIDAY_IN_ORG_B, true, orgAAdmin)
        .catch((e: any) => e);
      const nationalMiss = await service
        .updateHoliday(NATIONAL_HOLIDAY, true, orgAAdmin)
        .catch((e: any) => e);

      expect(realMiss).toBeInstanceOf(NotFoundError);
      expect(crossOrgMiss).toBeInstanceOf(NotFoundError);
      expect(nationalMiss).toBeInstanceOf(NotFoundError);

      expect(realMiss.message).toBe(crossOrgMiss.message);
      expect(realMiss.message).toBe(nationalMiss.message);

      expect(realMiss.statusCode).toBe(404);
      expect(crossOrgMiss.statusCode).toBe(404);
      expect(nationalMiss.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // deleteHoliday — same isolation rules, separate code path
  // ==========================================================================
  describe('deleteHoliday', () => {
    it('allows ORG_ADMIN to delete a holiday in their own org', async () => {
      await expect(
        service.deleteHoliday(HOLIDAY_IN_ORG_A, orgAAdmin),
      ).resolves.toEqual({ message: 'Holiday deleted' });

      expect(mockPrisma.holiday.delete).toHaveBeenCalledWith({
        where: { id: HOLIDAY_IN_ORG_A },
      });
    });

    it("rejects ORG_ADMIN trying to delete another org's holiday with NotFoundError", async () => {
      await expect(
        service.deleteHoliday(HOLIDAY_IN_ORG_B, orgAAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockPrisma.holiday.delete).not.toHaveBeenCalled();
    });

    it('rejects ORG_ADMIN trying to delete a national holiday with NotFoundError (H-2)', async () => {
      // orgBAdmin here — same rule from either org.
      await expect(
        service.deleteHoliday(NATIONAL_HOLIDAY, orgBAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockPrisma.holiday.delete).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to delete a national holiday', async () => {
      await expect(
        service.deleteHoliday(NATIONAL_HOLIDAY, superAdmin),
      ).resolves.toEqual({ message: 'Holiday deleted' });

      expect(mockPrisma.holiday.delete).toHaveBeenCalledWith({
        where: { id: NATIONAL_HOLIDAY },
      });
    });

    it('allows SUPER_ADMIN to delete any org-scoped holiday', async () => {
      await expect(
        service.deleteHoliday(HOLIDAY_IN_ORG_B, superAdmin),
      ).resolves.toEqual({ message: 'Holiday deleted' });

      expect(mockPrisma.holiday.delete).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundError for a non-existent holiday UUID', async () => {
      await expect(
        service.deleteHoliday(NONEXISTENT_ID, orgAAdmin),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockPrisma.holiday.delete).not.toHaveBeenCalled();
    });
  });
});
