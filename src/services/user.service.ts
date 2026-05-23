import prisma from '../lib/prisma';
import { JWTPayload } from '../lib/jwt';
import { getBranchScope } from '../lib/branch-scope';
import { hashPassword } from '../lib/password';
import { randomInt } from 'crypto';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors';
import { createLogger } from '../logger';
import { emailService } from './email.service';
import { CreateUserInput, UpdateUserInput, AddExistingUserInput } from '../schemas/user.schema';
import { generatePlatformId } from '../utils/platformId';
import { invalidatePlanCache } from './plan.service';
import { config } from '../config';

const log = createLogger('user-service');

/**
 * Generate a random temporary password that satisfies all validation rules:
 * 8+ chars, uppercase, lowercase, digit, special character.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;

  // Guarantee at least one of each category
  const chars: string[] = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    special[randomInt(special.length)],
  ];

  // Fill remaining 6 chars randomly
  for (let i = 0; i < 6; i++) {
    chars.push(all[randomInt(all.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * Shape the combined user+membership data into a flat response object
 * that matches the previous API response shape. This minimizes frontend changes.
 */
function flattenMembershipResponse(membership: any) {
  const user = membership.user;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth,
    platformId: user.platformId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // Membership fields (appear as if they're on User for backward compat)
    membershipId: membership.id,
    role: membership.role,
    employeeId: membership.employeeId,
    panNumber: membership.panNumber,
    isActive: membership.isActive,
    isFieldStaff: membership.isFieldStaff,
    branchId: membership.branchId,
    shiftStartTime: membership.shiftStartTime,
    shiftEndTime: membership.shiftEndTime,
    workingDays: membership.workingDays,
    organizationId: membership.organizationId,
    joinedAt: membership.joinedAt,
    leftAt: membership.leftAt,
  };
}

// Select fields when querying memberships with user data
const MEMBERSHIP_WITH_USER_SELECT = {
  id: true,
  role: true,
  employeeId: true,
  panNumber: true,
  isActive: true,
  isFieldStaff: true,
  branchId: true,
  shiftStartTime: true,
  shiftEndTime: true,
  workingDays: true,
  organizationId: true,
  joinedAt: true,
  leftAt: true,
  deletedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      dateOfBirth: true,
      platformId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

export class UserService {

  /**
   * List users — scoped to organization via OrgMembership.
   * Only returns active memberships (not departed employees).
   */
  async listUsers(currentUser: JWTPayload, filters?: { isFieldStaff?: boolean }) {
    // SUPER_ADMIN: list all users across all orgs
    if (currentUser.role === 'SUPER_ADMIN') {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          platformId: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          memberships: {
            select: {
              id: true,
              role: true,
              employeeId: true,
              organizationId: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return users;
    }

    // Org users: list through OrgMembership
    if (!currentUser.organizationId) {
      return [];
    }

    const scope = getBranchScope(currentUser);

    const memberships = await prisma.orgMembership.findMany({
      where: {
        organizationId: currentUser.organizationId,
        deletedAt: null,
        leftAt: null,
        ...(filters?.isFieldStaff !== undefined ? { isFieldStaff: filters.isFieldStaff } : {}),
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
      },
      select: MEMBERSHIP_WITH_USER_SELECT,
      orderBy: { user: { createdAt: 'desc' } },
    });

    return memberships.map(flattenMembershipResponse);
  }

  /**
   * Create user — creates User (if new) + OrgMembership in a transaction.
   * If user already exists (by email), only creates a new membership.
   */
  async createUser(input: CreateUserInput, currentUser: JWTPayload) {
    if ((input as any).role === 'SUPER_ADMIN') {
      throw new ConflictError('Cannot create super admin accounts');
    }

    // Phase 6 — BRANCH_ADMIN write guards:
    //  - They cannot create ORG_ADMIN or other BRANCH_ADMIN accounts (no
    //    privilege escalation, no cross-branch admin sprawl).
    //  - They cannot create users in any branch other than their own; we
    //    silently force the branchId so the form's hidden value can't be
    //    spoofed.
    if (currentUser.role === 'BRANCH_ADMIN') {
      const targetRole = (input as any).role as string | undefined;
      if (targetRole === 'ORG_ADMIN' || targetRole === 'BRANCH_ADMIN') {
        throw new ValidationError(
          'Branch admins cannot create org admins or other branch admins.',
          'FORBIDDEN_ROLE',
        );
      }
      if (!currentUser.branchId) {
        throw new ValidationError(
          'Your account has no branch assigned. Contact your administrator.',
          'NO_BRANCH_ASSIGNED',
        );
      }
      (input as any).branchId = currentUser.branchId;
    }

    const organizationId = currentUser.organizationId;
    if (!organizationId && currentUser.role !== 'SUPER_ADMIN') {
      throw new Error('No organization assigned to current user');
    }

    // Employee cap check — count active memberships, not users
    if (organizationId && currentUser.role !== 'SUPER_ADMIN') {
      const subscription = await prisma.orgSubscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });

      if (subscription) {
        const cap = subscription.customMaxEmployees ?? subscription.plan.maxEmployees;
        if (cap && subscription.currentEmployeeCount >= cap) {
          throw new ConflictError(
            `Employee limit reached. Your current plan allows up to ${cap} employees. Please upgrade to add more.`
          );
        }
      }
    }

    // Check if user with this email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });

    if (existingUser) {
      // User exists — check if they already have a membership in this org
      if (organizationId) {
        const existingMembership = await prisma.orgMembership.findUnique({
          where: { userId_organizationId: { userId: existingUser.id, organizationId } },
        });

        if (existingMembership) {
          if (existingMembership.isActive && !existingMembership.leftAt) {
            throw new ConflictError('User is already an active member of this organization');
          }
          // Reactivate departed membership
          throw new ConflictError(
            'User previously belonged to this organization. Use the reactivate flow instead.'
          );
        }
      }

      // User exists in another org — guide admin to use Platform ID flow
      throw new ConflictError(
        'A user with this email already exists on the platform. To add them to your organization, use "Add existing employee" with their Platform ID.'
      );
    }

    // New user — create User + OrgMembership in transaction
    const tempPassword = input.password ? undefined : generateTempPassword();
    const passwordToHash = input.password || tempPassword!;
    const hashedPassword = await hashPassword(passwordToHash);
    const employeeId = await this.generateEmployeeId(organizationId);
    const platformId = await generatePlatformId();
    const plainPin = String(randomInt(1000, 9999 + 1)).padStart(4, '0');
    const attendancePinHash = await hashPassword(plainPin);

    // Resolve which branch this new employee belongs to.
    //  - If branchId is provided, validate it belongs to this org and is active.
    //  - Otherwise, default to the org's Main Branch (isMain=true).
    //  - If neither is available (org with no Main Branch yet — shouldn't
    //    happen after the Phase 1 backfill), leave null and fall back to
    //    org-level geofence at clock-in time.
    let resolvedBranchId: string | null = null;
    if ((input as any).branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: (input as any).branchId,
          organizationId: organizationId!,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError(
          'Branch not found or does not belong to this organization.',
          'INVALID_BRANCH',
        );
      }
      resolvedBranchId = branch.id;
    } else {
      const mainBranch = await prisma.branch.findFirst({
        where: {
          organizationId: organizationId!,
          isMain: true,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      resolvedBranchId = mainBranch?.id ?? null;
    }

    // Phase 6 — BRANCH_ADMIN must always be assigned to a branch. The Main
    // Branch fallback should normally catch this, but if for some reason no
    // active main branch exists, refuse to create a branch admin in limbo.
    if ((input as any).role === 'BRANCH_ADMIN' && !resolvedBranchId) {
      throw new ValidationError(
        'Branch admins must be assigned to a branch.',
        'BRANCH_ADMIN_NEEDS_BRANCH',
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create platform-level user
      const user = await tx.user.create({
        data: {
          email: input.email,
          password: hashedPassword,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          dateOfBirth: (input as any).dateOfBirth ? new Date((input as any).dateOfBirth) : null,
          platformId,
          role: 'EMPLOYEE', // Platform-level default; effective role is on membership
          mustChangePassword: !!tempPassword, // Force password change when using auto-generated password
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          phone: true,
          platformId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Create org membership
      const membership = await tx.orgMembership.create({
        data: {
          userId: user.id,
          organizationId: organizationId!,
          role: input.role,
          employeeId,
          branchId: resolvedBranchId,
          shiftStartTime: input.shiftStartTime || null,
          shiftEndTime: input.shiftEndTime || null,
          workingDays: input.workingDays || null,
          panNumber: input.panNumber || null,
          attendancePinHash,
          isActive: true,
        },
      });

      return { user, membership };
    });

    log.info(
      { userId: result.user.id, membershipId: result.membership.id, orgId: organizationId },
      'User and membership created'
    );

    // Sync employee count after creation
    if (organizationId) {
      await this.syncEmployeeCount(organizationId);
    }

    // Send welcome email
    try {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId! },
        select: { name: true },
      });

      emailService.sendWelcomeEmail({
        to: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        employeeId,
        tempPassword,
        pin: plainPin,
        downloadUrl: config.APP_DOWNLOAD_URL,
        orgName: org?.name || '',
      }).catch(err => log.error({ err }, 'Failed to send welcome email'));
    } catch (err) {
      log.error({ err }, 'Failed to send welcome email');
    }

    return {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      phone: result.user.phone,
      platformId: result.user.platformId,
      membershipId: result.membership.id,
      role: result.membership.role,
      employeeId: result.membership.employeeId,
      organizationId: result.membership.organizationId,
      isActive: result.membership.isActive,
      createdAt: result.user.createdAt,
      pin: plainPin,
    };
  }

  /**
   * Add an existing platform user to the organization by their Platform ID.
   * Looks up the user, verifies they exist and don't already have an active membership,
   * then creates a new OrgMembership (or reactivates a departed one).
   */
  async addExistingUserByPlatformId(input: AddExistingUserInput, currentUser: JWTPayload) {
    // Phase 6 — same BRANCH_ADMIN write guards as createUser
    if (currentUser.role === 'BRANCH_ADMIN') {
      const targetRole = (input as any).role as string | undefined;
      if (targetRole === 'ORG_ADMIN' || targetRole === 'BRANCH_ADMIN') {
        throw new ValidationError(
          'Branch admins cannot create org admins or other branch admins.',
          'FORBIDDEN_ROLE',
        );
      }
      if (!currentUser.branchId) {
        throw new ValidationError(
          'Your account has no branch assigned. Contact your administrator.',
          'NO_BRANCH_ASSIGNED',
        );
      }
      (input as any).branchId = currentUser.branchId;
    }

    const organizationId = currentUser.organizationId;
    if (!organizationId) {
      throw new Error('No organization assigned to current user');
    }

    // Employee cap check
    const subscription = await prisma.orgSubscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    if (subscription) {
      const cap = subscription.customMaxEmployees ?? subscription.plan.maxEmployees;
      if (cap && subscription.currentEmployeeCount >= cap) {
        throw new ConflictError(
          `Employee limit reached. Your current plan allows up to ${cap} employees. Please upgrade to add more.`
        );
      }
    }

    // Look up user by platformId
    const existingUser = await prisma.user.findUnique({
      where: { platformId: input.platformId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        platformId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!existingUser) {
      throw new NotFoundError('No user found with this Platform ID. Please verify the ID and try again.');
    }

    // Check if they already have a membership in this org
    const existingMembership = await prisma.orgMembership.findUnique({
      where: {
        userId_organizationId: {
          userId: existingUser.id,
          organizationId,
        },
      },
    });

    if (existingMembership) {
      if (existingMembership.isActive && !existingMembership.leftAt) {
        throw new ConflictError('This user is already an active member of your organization.');
      }

      // Reactivate departed membership
      const reactivated = await prisma.orgMembership.update({
        where: { id: existingMembership.id },
        data: {
          isActive: true,
          leftAt: null,
          deletedAt: null,
          role: input.role as any,
          panNumber: input.panNumber || existingMembership.panNumber,
          shiftStartTime: input.shiftStartTime || existingMembership.shiftStartTime,
          shiftEndTime: input.shiftEndTime || existingMembership.shiftEndTime,
          workingDays: input.workingDays || existingMembership.workingDays,
          joinedAt: new Date(),
        },
      });

      log.info(
        { userId: existingUser.id, membershipId: reactivated.id, orgId: organizationId },
        'Membership reactivated for returning employee'
      );

      await this.syncEmployeeCount(organizationId);

      // Generate a new PIN for the reactivated member
      const plainPin = String(randomInt(1000, 9999 + 1)).padStart(4, '0');
      const attendancePinHash = await hashPassword(plainPin);
      await prisma.orgMembership.update({
        where: { id: reactivated.id },
        data: { attendancePinHash },
      });

      return {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        phone: existingUser.phone,
        platformId: existingUser.platformId,
        membershipId: reactivated.id,
        role: reactivated.role,
        employeeId: reactivated.employeeId,
        organizationId: reactivated.organizationId,
        isActive: true,
        createdAt: existingUser.createdAt,
        reactivated: true,
        pin: plainPin,
      };
    }

    // Brand new membership for this org
    const employeeId = await this.generateEmployeeId(organizationId);
    const plainPin = String(randomInt(1000, 9999 + 1)).padStart(4, '0');
    const attendancePinHash = await hashPassword(plainPin);

    // Default to org's Main Branch (Platform ID flow doesn't ask for branch yet —
    // admin can change it later from the Manage Staff page).
    // Resolve branch — same logic as createUser. The Phase 6 write guard
    // above already forces branchId to the caller's branch for BRANCH_ADMIN.
    let resolvedBranchId: string | null = null;
    if ((input as any).branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: (input as any).branchId,
          organizationId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError(
          'Branch not found or does not belong to this organization.',
          'INVALID_BRANCH',
        );
      }
      resolvedBranchId = branch.id;
    } else {
      const mainBranch = await prisma.branch.findFirst({
        where: {
          organizationId,
          isMain: true,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      resolvedBranchId = mainBranch?.id ?? null;
    }

    if ((input as any).role === 'BRANCH_ADMIN' && !resolvedBranchId) {
      throw new ValidationError(
        'Branch admins must be assigned to a branch.',
        'BRANCH_ADMIN_NEEDS_BRANCH',
      );
    }

    const membership = await prisma.orgMembership.create({
      data: {
        userId: existingUser.id,
        organizationId,
        role: input.role as any,
        employeeId,
        branchId: resolvedBranchId,
        shiftStartTime: input.shiftStartTime || null,
        shiftEndTime: input.shiftEndTime || null,
        workingDays: input.workingDays || null,
        panNumber: input.panNumber || null,
        attendancePinHash,
        isActive: true,
      },
    });

    log.info(
      { userId: existingUser.id, membershipId: membership.id, orgId: organizationId },
      'Existing user added to organization via Platform ID'
    );

    await this.syncEmployeeCount(organizationId);

    // Send notification email
    try {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });

      emailService.sendWelcomeEmail({
        to: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        employeeId,
        pin: plainPin,
        downloadUrl: config.APP_DOWNLOAD_URL,
        orgName: org?.name || '',
      }).catch(err => log.error({ err }, 'Failed to send org-join notification email'));
    } catch (err) {
      log.error({ err }, 'Failed to send org-join notification email');
    }

    return {
      id: existingUser.id,
      email: existingUser.email,
      firstName: existingUser.firstName,
      lastName: existingUser.lastName,
      phone: existingUser.phone,
      platformId: existingUser.platformId,
      membershipId: membership.id,
      role: membership.role,
      employeeId: membership.employeeId,
      organizationId: membership.organizationId,
      isActive: membership.isActive,
    isFieldStaff: membership.isFieldStaff,
      createdAt: existingUser.createdAt,
      pin: plainPin,
    };
  }

  /**
   * Update user — splits updates between User (platform fields) and OrgMembership (org fields).
   * Includes last-admin guard on role changes.
   */
  async updateUser(userId: string, input: UpdateUserInput, currentUser: JWTPayload) {
    // Find the user
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // For non-SUPER_ADMIN: verify the target user has a membership in the same org
    let existingMembership: any = null;
    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      existingMembership = await prisma.orgMembership.findFirst({
        where: {
          userId,
          organizationId: currentUser.organizationId,
        },
        select: { id: true, role: true, isActive: true, organizationId: true, branchId: true },
      });

      if (!existingMembership) {
        throw new NotFoundError('User not found in your organization');
      }
    }

    // Phase 6 — BRANCH_ADMIN write guards:
    //  - They can only edit users currently in their branch.
    //  - They cannot promote anyone to ORG_ADMIN or BRANCH_ADMIN.
    //  - They cannot reassign a user to a different branch (would move them
    //    out of the caller's authority).
    if (currentUser.role === 'BRANCH_ADMIN') {
      if (!currentUser.branchId) {
        throw new ValidationError(
          'Your account has no branch assigned. Contact your administrator.',
          'NO_BRANCH_ASSIGNED',
        );
      }
      if (existingMembership && existingMembership.branchId !== currentUser.branchId) {
        throw new NotFoundError('User not found in your branch');
      }
      const nextRole = (input as any).role as string | undefined;
      if (nextRole === 'ORG_ADMIN' || nextRole === 'BRANCH_ADMIN') {
        throw new ValidationError(
          'Branch admins cannot promote users to org admin or branch admin.',
          'FORBIDDEN_ROLE',
        );
      }
      const nextBranchId = (input as any).branchId as string | undefined | null;
      if (nextBranchId !== undefined && nextBranchId !== currentUser.branchId) {
        throw new ValidationError(
          'Branch admins cannot reassign employees to other branches.',
          'CROSS_BRANCH_REASSIGNMENT',
        );
      }
    }

    // Last-admin guard: before demoting an ORG_ADMIN, ensure another admin remains
    if (
      input.role &&
      input.role !== 'ORG_ADMIN' &&
      existingMembership?.role === 'ORG_ADMIN' &&
      existingMembership?.organizationId
    ) {
      const adminCount = await prisma.orgMembership.count({
        where: {
          organizationId: existingMembership.organizationId,
          role: 'ORG_ADMIN',
          isActive: true,
          leftAt: null,
          id: { not: existingMembership.id },
        },
      });

      if (adminCount < 1) {
        throw new ConflictError(
          'Cannot demote this admin — they are the last admin in the organization. Assign another admin first.'
        );
      }
    }

    // Split fields: User (platform) vs OrgMembership (org-scoped)
    const userUpdateData: Record<string, unknown> = {};
    const membershipUpdateData: Record<string, unknown> = {};

    // Platform-level fields → User table
    if (input.email) userUpdateData.email = input.email;
    if (input.firstName) userUpdateData.firstName = input.firstName;
    if (input.lastName) userUpdateData.lastName = input.lastName;
    if (input.phone !== undefined) userUpdateData.phone = input.phone;
    if ((input as any).dateOfBirth !== undefined) {
      userUpdateData.dateOfBirth = (input as any).dateOfBirth
        ? new Date((input as any).dateOfBirth)
        : null;
    }
    if (input.password) {
      userUpdateData.password = await hashPassword(input.password);
    }

    // Org-scoped fields → OrgMembership table
    if (input.role) membershipUpdateData.role = input.role;
    if (input.isActive !== undefined) membershipUpdateData.isActive = input.isActive;
    if ((input as any).isFieldStaff !== undefined) membershipUpdateData.isFieldStaff = (input as any).isFieldStaff;
    if (input.shiftStartTime !== undefined) membershipUpdateData.shiftStartTime = input.shiftStartTime || null;
    if (input.shiftEndTime !== undefined) membershipUpdateData.shiftEndTime = input.shiftEndTime || null;
    if (input.workingDays !== undefined) membershipUpdateData.workingDays = input.workingDays || null;
    if (input.panNumber !== undefined) membershipUpdateData.panNumber = input.panNumber || null;

    // Branch assignment — validate the branch belongs to the membership's org.
    // Null means "unassign" (membership falls back to org-level geofence).
    if ((input as any).branchId !== undefined && existingMembership) {
      const newBranchId = (input as any).branchId as string | null;
      if (newBranchId !== null) {
        const branch = await prisma.branch.findFirst({
          where: {
            id: newBranchId,
            organizationId: existingMembership.organizationId,
            deletedAt: null,
            isActive: true,
          },
          select: { id: true },
        });
        if (!branch) {
          throw new ValidationError(
            'Branch not found or does not belong to this organization.',
            'INVALID_BRANCH',
          );
        }
      }
      membershipUpdateData.branchId = newBranchId;
    }

    // Execute updates in transaction
    const result = await prisma.$transaction(async (tx) => {
      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: userId },
          data: userUpdateData,
        });
      }

      if (Object.keys(membershipUpdateData).length > 0 && existingMembership) {
        await tx.orgMembership.update({
          where: { id: existingMembership.id },
          data: membershipUpdateData,
        });
      }

      // Re-fetch combined data for response
      if (existingMembership) {
        return tx.orgMembership.findUnique({
          where: { id: existingMembership.id },
          select: MEMBERSHIP_WITH_USER_SELECT,
        });
      } else {
        // SUPER_ADMIN updating user without org context
        return tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            platformId: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }
    });

    log.info(
      { userId, updatedUserFields: Object.keys(userUpdateData), updatedMembershipFields: Object.keys(membershipUpdateData) },
      'User updated'
    );

    // Sync employee count if active status changed
    if (input.isActive !== undefined && existingMembership?.isActive !== input.isActive && existingMembership?.organizationId) {
      await this.syncEmployeeCount(existingMembership.organizationId);
    }

    // Return flattened response if membership exists
    if (existingMembership && result && 'user' in result) {
      return flattenMembershipResponse(result);
    }
    return result;
  }

  /**
   * Reset attendance PIN — admin action.
   * PIN now lives on OrgMembership.
   */
  async resetAttendancePin(userId: string, currentUser: JWTPayload) {
    if (!currentUser.organizationId) {
      throw new NotFoundError('No organization context');
    }

    // Find the target user's membership in this org
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId,
        organizationId: currentUser.organizationId,
        deletedAt: null,
      },
    });
    if (!membership) throw new NotFoundError('User not found in your organization');

    const pin = String(randomInt(1000, 9999 + 1)).padStart(4, '0');
    const attendancePinHash = await hashPassword(pin);

    await prisma.orgMembership.update({
      where: { id: membership.id },
      data: { attendancePinHash },
    });

    log.info({ membershipId: membership.id, resetBy: currentUser.userId }, 'Attendance PIN reset');
    return { pin, message: 'Attendance PIN reset successfully' };
  }

  /**
   * Remove employee from organization.
   * Deactivates membership — user account remains intact.
   * Replaces the old deleteUser which soft-deleted the user row.
   */
  async removeFromOrganization(userId: string, currentUser: JWTPayload) {
    if (userId === currentUser.userId) {
      throw new ConflictError('Cannot remove yourself from the organization');
    }

    if (!currentUser.organizationId) {
      throw new NotFoundError('No organization context');
    }

    // Find the membership
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId,
        organizationId: currentUser.organizationId,
      },
      select: { id: true, role: true, isActive: true, organizationId: true },
    });

    if (!membership) {
      throw new NotFoundError('User not found in your organization');
    }

    // Last-admin guard
    if (membership.role === 'ORG_ADMIN') {
      const adminCount = await prisma.orgMembership.count({
        where: {
          organizationId: membership.organizationId,
          role: 'ORG_ADMIN',
          isActive: true,
          leftAt: null,
          id: { not: membership.id },
        },
      });

      if (adminCount < 1) {
        throw new ConflictError(
          'Cannot remove this admin — they are the last admin in the organization. Assign another admin first.'
        );
      }
    }

    // Deactivate membership (user row untouched)
    await prisma.orgMembership.update({
      where: { id: membership.id },
      data: {
        isActive: false,
        leftAt: new Date(),
        deletedAt: new Date(),
      },
    });

    log.info({ userId, membershipId: membership.id, removedBy: currentUser.userId }, 'Employee removed from organization');

    // Sync employee count
    await this.syncEmployeeCount(membership.organizationId);

    return { message: 'Employee removed from organization successfully' };
  }

  /**
   * Sync employee count on OrgSubscription.
   * Counts only active, non-departed memberships with EMPLOYEE or ORG_ACCOUNTANT role.
   */
  private async syncEmployeeCount(organizationId: string): Promise<void> {
    try {
      const count = await prisma.orgMembership.count({
        where: {
          organizationId,
          isActive: true,
          leftAt: null,
          role: { in: ['EMPLOYEE', 'ORG_ACCOUNTANT'] },
        },
      });

      await prisma.orgSubscription.updateMany({
        where: { organizationId },
        data: { currentEmployeeCount: count },
      });

      invalidatePlanCache(organizationId);

      log.info({ organizationId, count }, 'Employee count synced');
    } catch (err) {
      log.error({ err, organizationId }, 'Failed to sync employee count');
    }
  }

  /**
   * Generate unique employee ID scoped to the organization via OrgMembership.
   */
  private async generateEmployeeId(organizationId?: string | null): Promise<string> {
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const randomNum = randomInt(10000, 99999);
      const employeeId = `${randomNum}`;

      const existing = await prisma.orgMembership.findFirst({
        where: {
          employeeId,
          ...(organizationId ? { organizationId } : {}),
        },
      });

      if (!existing) return employeeId;
    }

    // Fallback: use crypto random bytes for guaranteed uniqueness
    const { randomBytes } = await import('crypto');
    return `${randomBytes(3).toString('hex').toUpperCase()}`;
  }
}

export const userService = new UserService();