/**
 * Phase 6 — branch scope helper tests.
 *
 * Pure function: given a JWT payload, return the branch filter to apply.
 * The single rule is: only BRANCH_ADMIN gets restricted to a single branch;
 * every other role gets org-wide or platform-wide visibility.
 */

import { getBranchScope, branchWhere, resolveBranchFilter } from '../branch-scope';
import { JWTPayload } from '../jwt';

const baseUser = (overrides: Partial<JWTPayload>): JWTPayload => ({
  userId: 'u1',
  id: 'u1',
  email: 'test@example.com',
  role: 'EMPLOYEE',
  organizationId: 'org1',
  membershipId: 'm1',
  branchId: null,
  ...overrides,
});

describe('getBranchScope', () => {
  it('returns null branchId when user is undefined', () => {
    expect(getBranchScope(undefined)).toEqual({ branchId: null });
  });

  it('returns null branchId for SUPER_ADMIN', () => {
    expect(
      getBranchScope(baseUser({ role: 'SUPER_ADMIN', organizationId: null, membershipId: null })),
    ).toEqual({ branchId: null });
  });

  it('returns null branchId for ORG_ADMIN (org-wide visibility)', () => {
    expect(getBranchScope(baseUser({ role: 'ORG_ADMIN', branchId: null }))).toEqual({
      branchId: null,
    });
  });

  it('returns null branchId for ORG_ADMIN even when they happen to have a branchId', () => {
    // ORG_ADMIN users typically have no branchId, but if for some reason one
    // is set on their membership (e.g. they used to be a branch admin), they
    // must still see org-wide data once promoted to ORG_ADMIN.
    expect(getBranchScope(baseUser({ role: 'ORG_ADMIN', branchId: 'b1' }))).toEqual({
      branchId: null,
    });
  });

  it('returns null branchId for ORG_ACCOUNTANT', () => {
    expect(getBranchScope(baseUser({ role: 'ORG_ACCOUNTANT' }))).toEqual({ branchId: null });
  });

  it('returns null branchId for EMPLOYEE', () => {
    expect(getBranchScope(baseUser({ role: 'EMPLOYEE' }))).toEqual({ branchId: null });
  });

  it('returns the assigned branchId for BRANCH_ADMIN', () => {
    expect(
      getBranchScope(baseUser({ role: 'BRANCH_ADMIN', branchId: 'pokhara-uuid' })),
    ).toEqual({ branchId: 'pokhara-uuid' });
  });

  it('returns null for a BRANCH_ADMIN with no assigned branch (defensive)', () => {
    // Should never happen in practice — the create flow requires a branch —
    // but if a JWT slipped through without one, return null so the caller
    // doesn't accidentally apply `branchId: undefined` to a Prisma where.
    expect(getBranchScope(baseUser({ role: 'BRANCH_ADMIN', branchId: null }))).toEqual({
      branchId: null,
    });
  });
});

describe('branchWhere', () => {
  it('returns empty object when scope is null', () => {
    expect(branchWhere({ branchId: null })).toEqual({});
  });

  it('returns { branchId } when scope is set, ready to spread into Prisma where', () => {
    expect(branchWhere({ branchId: 'b1' })).toEqual({ branchId: 'b1' });
  });

  it('is spreadable into a Prisma where without leaking undefined', () => {
    const where = { organizationId: 'o1', ...branchWhere({ branchId: null }) };
    expect(where).toEqual({ organizationId: 'o1' });
    expect('branchId' in where).toBe(false);
  });
});

describe('resolveBranchFilter (Phase 8b — voluntary narrowing)', () => {
  it('ignores explicit branchId for BRANCH_ADMIN — cannot spoof another branch', () => {
    // Branch admin tries to pass a different branch via query param. The
    // helper must return their own branch, not the spoofed one.
    expect(
      resolveBranchFilter(
        baseUser({ role: 'BRANCH_ADMIN', branchId: 'pokhara-uuid' }),
        'kathmandu-uuid-spoof',
      ),
    ).toEqual({ branchId: 'pokhara-uuid' });
  });

  it('ignores undefined explicit branchId for BRANCH_ADMIN — still locked to own branch', () => {
    expect(
      resolveBranchFilter(
        baseUser({ role: 'BRANCH_ADMIN', branchId: 'pokhara-uuid' }),
        undefined,
      ),
    ).toEqual({ branchId: 'pokhara-uuid' });
  });

  it('lets ORG_ADMIN voluntarily narrow with explicit branchId', () => {
    expect(
      resolveBranchFilter(baseUser({ role: 'ORG_ADMIN' }), 'pokhara-uuid'),
    ).toEqual({ branchId: 'pokhara-uuid' });
  });

  it('returns null branchId for ORG_ADMIN when no explicit branchId is passed', () => {
    expect(resolveBranchFilter(baseUser({ role: 'ORG_ADMIN' }), undefined)).toEqual({
      branchId: null,
    });
  });

  it('lets ORG_ACCOUNTANT voluntarily narrow with explicit branchId', () => {
    expect(
      resolveBranchFilter(baseUser({ role: 'ORG_ACCOUNTANT' }), 'pokhara-uuid'),
    ).toEqual({ branchId: 'pokhara-uuid' });
  });

  it('lets SUPER_ADMIN voluntarily narrow with explicit branchId', () => {
    expect(
      resolveBranchFilter(
        baseUser({ role: 'SUPER_ADMIN', organizationId: null, membershipId: null }),
        'any-branch-uuid',
      ),
    ).toEqual({ branchId: 'any-branch-uuid' });
  });

  it('treats null explicit branchId the same as undefined', () => {
    expect(resolveBranchFilter(baseUser({ role: 'ORG_ADMIN' }), null)).toEqual({
      branchId: null,
    });
  });

  it('returns null branchId when user is undefined and no explicit branchId', () => {
    expect(resolveBranchFilter(undefined, undefined)).toEqual({ branchId: null });
  });

  it('returns explicit branchId when user is undefined but explicit branchId is set', () => {
    // Edge case: anonymous caller with a query param. The user being undefined
    // means getBranchScope returns null, so the explicit narrowing wins.
    // In practice, route auth middleware will reject before this is reached.
    expect(resolveBranchFilter(undefined, 'b1')).toEqual({ branchId: 'b1' });
  });
});
