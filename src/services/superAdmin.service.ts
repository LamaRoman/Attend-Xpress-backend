import prisma from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { Role } from '@prisma/client';
import { NotFoundError, ConflictError } from '../lib/errors';
import { createLogger } from '../logger';
import { CreateOrganizationInput, UpdateOrganizationInput } from '../schemas/organization.schema';
import { notificationService } from './notification.service';


// Add this helper at the top of the file, after the imports
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
const log = createLogger('super-admin-service');

export class SuperAdminService {
  /**
   * Get all organizations with stats
   */
  async getAllOrganizations() {
    const organizations = await prisma.organization.findMany({
      include: {
        _count: {
          select: { memberships: true, attendanceRecords: true, paySettings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Efficient single grouped query for employee/admin counts via OrgMembership
    const orgIds = organizations.map(o => o.id);
    const roleCounts = await prisma.orgMembership.groupBy({
      by: ['organizationId', 'role'],
      where: {
        organizationId: { in: orgIds },
        isActive: true,
        leftAt: null,
        role: { in: ['EMPLOYEE', 'ORG_ADMIN'] },
      },
      _count: { id: true },
    });

    const roleMap: Record<string, { employees: number; admins: number }> = {};
    for (const row of roleCounts) {
      if (!roleMap[row.organizationId]) roleMap[row.organizationId] = { employees: 0, admins: 0 };
      if (row.role === 'EMPLOYEE') roleMap[row.organizationId].employees = row._count.id;
      if (row.role === 'ORG_ADMIN') roleMap[row.organizationId].admins = row._count.id;
    }

    return organizations.map((org) => ({
      id: org.id,
      name: org.name,
      email: org.email,
      phone: org.phone,
      address: org.address,
      isActive: org.isActive,
      staticQREnabled: org.staticQREnabled,
      rotatingQREnabled: org.rotatingQREnabled,
      ssfEnabled: org.ssfEnabled,
      pfEnabled: org.pfEnabled,
      citEnabled: org.citEnabled,
      tdsEnabled: org.tdsEnabled,
      language: org.language,
      calendarMode: org.calendarMode,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      stats: {
        totalUsers: org._count.memberships,
        totalAttendanceRecords: org._count.attendanceRecords,
        employeesWithPayroll: org._count.paySettings,
        totalEmployees: roleMap[org.id]?.employees ?? 0,
        totalAdmins: roleMap[org.id]?.admins ?? 0,
      },
    }));
  }

  /**
   * Get single organization details
   */
  async getOrganization(orgId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        memberships: {
          where: { leftAt: null },
          select: {
            id: true,
            employeeId: true,
            role: true,
            isActive: true,
            user: {
              select: {
                id: true, email: true, firstName: true, lastName: true, createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { attendanceRecords: true, paySettings: true, holidays: true },
        },
      },
    });

    if (!organization) throw new NotFoundError('Organization not found');

    // Flatten memberships → users array for frontend compatibility
    const users = organization.memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      employeeId: m.employeeId,
      role: m.role,
      isActive: m.isActive,
      createdAt: m.user.createdAt,
    }));

    return {
      ...organization,
      memberships: undefined, // Remove raw memberships from response
      users,
      stats: {
        totalAttendanceRecords: organization._count.attendanceRecords,
        employeesWithPayroll: organization._count.paySettings,
        customHolidays: organization._count.holidays,
      },
    };
  }

  /**
   * Create organization with org admin.
   * Creates User + OrgMembership in a transaction.
   */
  async createOrganization(input: CreateOrganizationInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.adminEmail } });
    if (existing) throw new ConflictError('Admin email already exists');

    const hashedPassword = await hashPassword(input.adminPassword);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          slug:generateSlug(input.name),
          email: input.email,
          phone: input.phone,
          address: input.address,
          calendarMode: input.calendarMode,
        },
      });

      // Create User (platform-level — no org-specific fields)
      const orgAdmin = await tx.user.create({
        data: {
          email: input.adminEmail,
          password: hashedPassword,
          firstName: input.adminFirstName,
          lastName: input.adminLastName,
          phone: input.adminPhone,
          role: Role.ORG_ADMIN, // Platform-level role hint
          isActive: true,
        },
      });

      // Create OrgMembership (org-scoped role + employeeId)
      const membership = await tx.orgMembership.create({
        data: {
          userId: orgAdmin.id,
          organizationId: organization.id,
          role: Role.ORG_ADMIN,
          isActive: true,
        },
      });

      return { organization, orgAdmin, membership };
    });

    log.info({ orgId: result.organization.id, orgName: input.name }, 'Organization created');

    return {
      organization: result.organization,
      orgAdmin: {
        id: result.orgAdmin.id,
        email: result.orgAdmin.email,
        firstName: result.orgAdmin.firstName,
        lastName: result.orgAdmin.lastName,
        role: result.membership.role,
      },
    };
  }

  /**
   * Update organization
   */
  async updateOrganization(orgId: string, input: UpdateOrganizationInput) {
    return prisma.organization.update({
      where: { id: orgId },
      data: input,
    });
  }

  /**
   * Toggle active status
   */
  async toggleStatus(orgId: string) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundError('Organization not found');

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { isActive: !org.isActive },
    });

    await notificationService.notifyOrgStatusChanged(orgId, updated.isActive);

    return updated;
  }

  /**
   * Soft delete (deactivate)
   */
  async deleteOrganization(orgId: string) {
    return prisma.organization.update({
      where: { id: orgId },
      data: { isActive: false },
    });
  }

  /**
   * Platform-wide statistics.
   * User counts now come from OrgMembership for org-scoped roles.
   * Total users = all memberships (not SUPER_ADMIN).
   */
  async getPlatformStats() {
    const [
      totalOrganizations, activeOrganizations,
      totalMemberships, totalEmployees, totalOrgAdmins,
      totalAttendanceRecords,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.orgMembership.count({ where: { isActive: true, leftAt: null } }),
      prisma.orgMembership.count({ where: { role: Role.EMPLOYEE, isActive: true, leftAt: null } }),
      prisma.orgMembership.count({ where: { role: Role.ORG_ADMIN, isActive: true, leftAt: null } }),
      prisma.attendanceRecord.count(),
    ]);

    const recentOrganizations = await prisma.organization.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, createdAt: true, isActive: true,
        _count: { select: { memberships: true } },
      },
    });

    return {
      stats: {
        organizations: {
          total: totalOrganizations,
          active: activeOrganizations,
          inactive: totalOrganizations - activeOrganizations,
        },
        users: { total: totalMemberships, employees: totalEmployees, orgAdmins: totalOrgAdmins },
        attendance: { totalRecords: totalAttendanceRecords },
      },
      recentOrganizations: recentOrganizations.map((org) => ({
        ...org,
        userCount: org._count.memberships,
      })),
    };
  }

  // ======== TDS Slab Management ========

  async getTDSSlabs() {
    const config = await prisma.systemConfig.findFirst({
      where: { key: 'tds_slabs' },
      orderBy: { updatedAt: 'desc' },
    });

    if (config) {
      return JSON.parse(config.value);
    }

    return {
      fiscalYear: '2081/82',
      unmarriedFirstSlab: 500000,
      marriedFirstSlab: 600000,
      slabs: [
        { limit: 200000, rate: 10, label: 'Second slab' },
        { limit: 300000, rate: 20, label: 'Third slab' },
        { limit: 1000000, rate: 30, label: 'Fourth slab' },
        { limit: 3000000, rate: 36, label: 'Fifth slab' },
        { limit: 0, rate: 39, label: 'Remaining (above)' },
      ],
      firstSlabRate: 1,
      updatedAt: null,
    };
  }

  async updateTDSSlabs(input: {
    fiscalYear: string;
    unmarriedFirstSlab: number;
    marriedFirstSlab: number;
    slabs: Array<{ limit: number; rate: number; label: string }>;
    firstSlabRate: number;
  }) {
    const value = JSON.stringify({
      ...input,
      updatedAt: new Date().toISOString(),
    });

    const existing = await prisma.systemConfig.findFirst({
      where: { key: 'tds_slabs' },
    });

    if (existing) {
      await prisma.systemConfig.update({
        where: { id: existing.id },
        data: { value },
      });
    } else {
      const anyOrg = await prisma.organization.findFirst();
      if (!anyOrg) throw new Error('No organization exists');

      await prisma.systemConfig.create({
        data: {
          organizationId: anyOrg.id,
          key: 'tds_slabs',
          value,
          description: 'Nepal TDS tax slabs - managed by Super Admin',
        },
      });
    }

    return JSON.parse(value);
  }
}

export const superAdminService = new SuperAdminService();