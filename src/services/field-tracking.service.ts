import prisma from '../lib/prisma';
import { JWTPayload } from '../lib/jwt';
import { NotFoundError, AuthorizationError } from '../lib/errors';
import { createLogger } from '../logger';
import { LocationPingInput } from '../schemas/field-tracking.schema';

const log = createLogger('field-tracking-service');

class FieldTrackingService {
  /**
   * Record a location ping for the currently clocked-in field staff member.
   * Called by the mobile app (or any authenticated client) every ~10 seconds.
   */
  async recordPing(input: LocationPingInput, currentUser: JWTPayload): Promise<void> {
    const membership = await prisma.orgMembership.findFirst({
      where: {
        userId: currentUser.userId,
        organizationId: currentUser.organizationId!,
        isActive: true,
        isFieldStaff: true,
      },
      select: { id: true, organizationId: true },
    });

    if (!membership) {
      throw new AuthorizationError('Field tracking is not enabled for this employee');
    }

    // Find the current open attendance record
    const openRecord = await prisma.attendanceRecord.findFirst({
      where: {
        membershipId: membership.id,
        status: 'CHECKED_IN',
      },
      select: { id: true },
      orderBy: { checkInTime: 'desc' },
    });

    await prisma.locationPing.create({
      data: {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        attendanceRecordId: openRecord?.id ?? null,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy ?? null,
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      },
    });

    log.debug({ membershipId: membership.id }, 'Location ping recorded');
  }

  /**
   * Get the latest ping for every currently clocked-in field staff member in the org.
   * Used for the live map view.
   *
   * When `branchId` is provided (BRANCH_ADMIN callers), the result is filtered
   * to memberships in that branch. Pass `null` for org-wide visibility.
   */
  async getLivePositions(
    organizationId: string,
    branchId: string | null = null,
  ): Promise<LivePosition[]> {
    // Find all field staff currently checked in
    const openRecords = await prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        status: 'CHECKED_IN',
        membership: {
          isFieldStaff: true,
          isActive: true,
          ...(branchId ? { branchId } : {}),
        },
      },
      select: {
        id: true,
        checkInTime: true,
        membership: {
          select: {
            id: true,
            user: { select: { id: true, firstName: true, lastName: true } },
            employeeId: true,
          },
        },
      },
    });

    if (openRecords.length === 0) return [];

    const membershipIds = openRecords.map((r) => r.membership.id);

    // Get the latest ping per membership in one query using a subquery approach
    // We fetch recent pings and deduplicate in memory — efficient for small field teams
    const recentPings = await prisma.locationPing.findMany({
      where: {
        membershipId: { in: membershipIds },
        recordedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // last 30 min
      },
      orderBy: { recordedAt: 'desc' },
      select: {
        id: true,
        membershipId: true,
        lat: true,
        lng: true,
        accuracy: true,
        recordedAt: true,
      },
    });

    // Keep only the latest ping per membership
    const latestByMembership = new Map<string, typeof recentPings[0]>();
    for (const ping of recentPings) {
      if (!latestByMembership.has(ping.membershipId)) {
        latestByMembership.set(ping.membershipId, ping);
      }
    }

    return openRecords.flatMap((record) => {
      const latestPing = latestByMembership.get(record.membership.id);
      if (!latestPing) return []; // field staff but no pings yet
      return [
        {
          membershipId: record.membership.id,
          employeeId: record.membership.employeeId,
          firstName: record.membership.user.firstName,
          lastName: record.membership.user.lastName,
          checkInTime: record.checkInTime,
          attendanceRecordId: record.id,
          lat: latestPing.lat,
          lng: latestPing.lng,
          accuracy: latestPing.accuracy,
          recordedAt: latestPing.recordedAt,
        },
      ];
    });
  }

  /**
   * Get the full route (ordered pings) for a specific employee on a specific calendar date.
   * Used for route replay.
   */
  async getRoute(
    membershipId: string,
    date: string, // YYYY-MM-DD
    currentUser: JWTPayload
  ): Promise<RoutePoint[]> {
    // Verify the membership belongs to this org
    const membership = await prisma.orgMembership.findFirst({
      where: { id: membershipId, organizationId: currentUser.organizationId! },
      select: { id: true },
    });

    if (!membership) throw new NotFoundError('Employee not found in your organization');

    const [y, m, d] = date.split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);

    const pings = await prisma.locationPing.findMany({
      where: {
        membershipId,
        recordedAt: { gte: start, lte: end },
      },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, accuracy: true, recordedAt: true },
    });

    return pings;
  }
}

export interface LivePosition {
  membershipId: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  checkInTime: Date;
  attendanceRecordId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: Date;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: Date;
}

export const fieldTrackingService = new FieldTrackingService();
