/**
 * Phase 6 — branch scoping helper.
 *
 * Given the authenticated user from the JWT, returns the branch filter that
 * should be applied to admin queries. The output is intentionally simple:
 *
 *   { branchId: null }       → no filter (org-wide or platform-wide visibility)
 *   { branchId: '<uuid>' }   → restrict to a single branch
 *
 * Call sites stay tiny:
 *
 *   const scope = getBranchScope(req.user);
 *   const where = {
 *     organizationId,
 *     ...(scope.branchId && { branchId: scope.branchId }),
 *   };
 *
 * Centralising this in one helper means we never accidentally drop the filter
 * when a BRANCH_ADMIN hits a new endpoint — every list/read just spreads the
 * scope into its `where` clause.
 */

import { JWTPayload } from './jwt';

export interface BranchScope {
  /**
   * The branch id the caller may see, or null for "see all branches".
   * - SUPER_ADMIN, ORG_ADMIN, ORG_ACCOUNTANT, EMPLOYEE → null (no extra filter)
   * - BRANCH_ADMIN → their own branchId
   */
  branchId: string | null;
}

export function getBranchScope(user: JWTPayload | undefined): BranchScope {
  if (!user) return { branchId: null };

  // Only BRANCH_ADMIN is restricted to a single branch. Everyone else either
  // has org-wide visibility (ORG_ADMIN, ORG_ACCOUNTANT) or platform-wide
  // (SUPER_ADMIN), or doesn't hit admin endpoints (EMPLOYEE).
  if (user.role === 'BRANCH_ADMIN') {
    return { branchId: user.branchId ?? null };
  }

  return { branchId: null };
}

/**
 * Convenience: build a Prisma `where` fragment for queries filtered by branch.
 * Returns an empty object when no scoping is needed, so it's safe to spread:
 *
 *   const memberships = await prisma.orgMembership.findMany({
 *     where: { organizationId, ...branchWhere(scope) },
 *   });
 */
export function branchWhere(scope: BranchScope): { branchId?: string } {
  return scope.branchId ? { branchId: scope.branchId } : {};
}

/**
 * Phase 8b — voluntary branch narrowing for ORG_ADMIN.
 *
 * BRANCH_ADMIN's scope is fixed: they always see their own branch and an
 * incoming `branchId` query param is ignored (they cannot spoof a different
 * branch). ORG_ADMIN / ORG_ACCOUNTANT / SUPER_ADMIN have no inherent scope,
 * but may pass an explicit `branchId` to voluntarily narrow what they see.
 *
 * Pattern in services:
 *   const scope = resolveBranchFilter(currentUser, branchIdFilter);
 *   const where = { ...branchWhere(scope), organizationId, ... };
 */
export function resolveBranchFilter(
  user: JWTPayload | undefined,
  explicitBranchId: string | undefined | null,
): BranchScope {
  const scope = getBranchScope(user);
  // BRANCH_ADMIN is locked — explicit param is ignored, can't override.
  if (scope.branchId) return scope;
  // ORG_ADMIN / ORG_ACCOUNTANT / SUPER_ADMIN can voluntarily narrow.
  if (explicitBranchId) return { branchId: explicitBranchId };
  return scope;
}
