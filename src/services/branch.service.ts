import prisma from '../lib/prisma';
import { JWTPayload } from '../lib/jwt';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors';
import { createLogger } from '../logger';
import {
  CreateBranchInput,
  UpdateBranchInput,
  UpdateBranchGeofenceInput,
  ListBranchesQuery,
} from '../schemas/branch.schema';

const log = createLogger('branch-service');

/**
 * Standard select projection used across all branch endpoints.
 * Keep this in one place so the response shape is consistent.
 */
const BRANCH_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  address: true,
  isMain: true,
  officeLat: true,
  officeLng: true,
  geofenceRadius: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

class BranchService {
  // ─── Reads ────────────────────────────────────────────────────────────────

  /**
   * List branches belonging to a single organization.
   * Used by ORG_ADMIN to populate branch pickers on their own pages.
   * Excludes soft-deleted (deletedAt != null) and inactive branches by default.
   *
   * Phase 8b — `includeDeleted` lets ORG_ADMIN access archived branches for
   * historical filtering on Reports / Payroll / Roster / Leaves. The route
   * layer is responsible for restricting this flag to ORG_ADMIN (never
   * BRANCH_ADMIN or ORG_ACCOUNTANT).
   */
  async listForOrganization(
    organizationId: string,
    includeInactive = false,
    includeDeleted = false,
  ) {
    // Soft delete sets BOTH deletedAt + isActive=false, so includeDeleted
    // implies includeInactive — otherwise archived branches would be hidden
    // by the active filter even when explicitly requested.
    const showInactive = includeInactive || includeDeleted;
    return prisma.branch.findMany({
      where: {
        organizationId,
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(showInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: BRANCH_SELECT,
    });
  }

  /**
   * List branches across all organizations. SUPER_ADMIN only.
   * Optional filter by organizationId.
   */
  async listAll(query: ListBranchesQuery) {
    return prisma.branch.findMany({
      where: {
        deletedAt: null,
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ organizationId: 'asc' }, { isMain: 'desc' }, { name: 'asc' }],
      select: {
        ...BRANCH_SELECT,
        organization: { select: { id: true, name: true, slug: true } },
        _count: { select: { memberships: { where: { isActive: true } } } },
      },
    });
  }

  /**
   * Get a single branch by id. Throws NotFoundError if missing or soft-deleted.
   * Org isolation: ORG_ADMIN can only read their own org; SUPER_ADMIN can read any.
   */
  async getById(id: string, currentUser: JWTPayload) {
    const branch = await prisma.branch.findFirst({
      where: { id, deletedAt: null },
      select: { ...BRANCH_SELECT, organization: { select: { id: true, name: true } } },
    });
    if (!branch) throw new NotFoundError('Branch not found');

    if (
      currentUser.role !== 'SUPER_ADMIN' &&
      branch.organizationId !== currentUser.organizationId
    ) {
      // Don't leak existence to other orgs — return NotFound.
      throw new NotFoundError('Branch not found');
    }

    return branch;
  }

  // ─── Writes (SUPER_ADMIN only — enforced at route layer) ───────────────────

  /**
   * Create a branch.
   *
   * - Validates the target organization exists.
   * - If isMain=true is requested, rejects when the org already has a main
   *   branch. Use this only for fresh orgs where no main exists yet, or after
   *   demoting the existing main (out of scope for Phase 2).
   */
  async create(input: CreateBranchInput) {
    const org = await prisma.organization.findFirst({
      where: { id: input.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!org) throw new ValidationError('Organization not found', 'INVALID_ORG');

    if (input.isMain) {
      const existingMain = await prisma.branch.findFirst({
        where: {
          organizationId: input.organizationId,
          isMain: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingMain) {
        throw new ConflictError(
          'This organization already has a main branch.',
          'MAIN_BRANCH_EXISTS',
        );
      }
    }

    const branch = await prisma.branch.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        address: input.address ?? null,
        isMain: input.isMain ?? false,
        officeLat: input.officeLat ?? null,
        officeLng: input.officeLng ?? null,
        geofenceRadius: input.geofenceRadius ?? null,
      },
      select: BRANCH_SELECT,
    });

    log.info(
      { branchId: branch.id, organizationId: branch.organizationId, isMain: branch.isMain },
      'Branch created',
    );
    return branch;
  }

  /**
   * Update an existing branch. Cannot change organizationId or isMain.
   */
  async update(id: string, input: UpdateBranchInput) {
    const existing = await prisma.branch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, isMain: true },
    });
    if (!existing) throw new NotFoundError('Branch not found');

    // Deactivating the main branch would leave new memberships without a default.
    if (existing.isMain && input.isActive === false) {
      throw new ConflictError(
        'The main branch cannot be deactivated.',
        'MAIN_BRANCH_PROTECTED',
      );
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.officeLat !== undefined ? { officeLat: input.officeLat } : {}),
        ...(input.officeLng !== undefined ? { officeLng: input.officeLng } : {}),
        ...(input.geofenceRadius !== undefined ? { geofenceRadius: input.geofenceRadius } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: BRANCH_SELECT,
    });

    log.info({ branchId: id, fields: Object.keys(input) }, 'Branch updated');
    return branch;
  }

  /**
   * Phase 9 — ORG_ADMIN updates only the geofence fields on a branch in their
   * own org. The org-isolation check is critical: an ORG_ADMIN in org A must
   * not be able to update branches in org B by passing a foreign branchId.
   *
   * Trust boundary: geofence controls who gets credited at clock-in.
   * BRANCH_ADMIN is intentionally barred from this — they would be editing
   * the rule that measures their own staff (and themselves).
   */
  async updateGeofence(
    id: string,
    currentUser: JWTPayload,
    input: UpdateBranchGeofenceInput,
  ) {
    if (!currentUser.organizationId) {
      throw new NotFoundError('Branch not found');
    }
    // Cross-org isolation: only branches in the caller's own org are eligible.
    // We use NotFoundError (not Forbidden) so we don't leak whether a branch
    // exists in another org.
    const existing = await prisma.branch.findFirst({
      where: { id, organizationId: currentUser.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Branch not found');

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        ...(input.officeLat !== undefined ? { officeLat: input.officeLat } : {}),
        ...(input.officeLng !== undefined ? { officeLng: input.officeLng } : {}),
        ...(input.geofenceRadius !== undefined ? { geofenceRadius: input.geofenceRadius } : {}),
      },
      select: BRANCH_SELECT,
    });

    log.info(
      { branchId: id, orgId: currentUser.organizationId, by: currentUser.userId, fields: Object.keys(input) },
      'Branch geofence updated by ORG_ADMIN',
    );
    return branch;
  }

  /**
   * Soft-delete a branch.
   *
   * Guards:
   *  - Cannot delete the main branch (org needs one).
   *  - Cannot delete a branch with active memberships — admin must reassign
   *    employees first. We return 409 with the count so the UI can show a
   *    helpful message.
   */
  async softDelete(id: string) {
    const branch = await prisma.branch.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        isMain: true,
        organizationId: true,
        _count: { select: { memberships: { where: { isActive: true } } } },
      },
    });
    if (!branch) throw new NotFoundError('Branch not found');

    if (branch.isMain) {
      throw new ConflictError(
        'The main branch cannot be deleted.',
        'MAIN_BRANCH_PROTECTED',
      );
    }

    if (branch._count.memberships > 0) {
      throw new ConflictError(
        `Cannot delete branch — ${branch._count.memberships} active employee(s) are still assigned. Reassign them first.`,
        'BRANCH_HAS_MEMBERS',
      );
    }

    await prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    log.info({ branchId: id, organizationId: branch.organizationId }, 'Branch soft-deleted');
  }
}

export const branchService = new BranchService();
