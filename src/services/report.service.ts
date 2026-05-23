import prisma from '../lib/prisma';
import { JWTPayload } from '../lib/jwt';
import { branchWhere, resolveBranchFilter } from '../lib/branch-scope';

export class ReportService {
  /**
   * Daily attendance report
   */
 async getDailyReport(date: Date, currentUser: JWTPayload, branchIdFilter?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const membershipWhere: Record<string, unknown> = {
      isActive: true,
      leftAt: null,
      role: 'EMPLOYEE',
      ...branchWhere(scope),
    };
    const attendanceWhere: Record<string, unknown> = {
      checkInTime: { gte: startOfDay, lte: endOfDay },
      ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
    };

    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      membershipWhere.organizationId = currentUser.organizationId;
      attendanceWhere.organizationId = currentUser.organizationId;
    }

    const [allMemberships, attendanceRecords, org] = await Promise.all([
      prisma.orgMembership.findMany({
        where: membershipWhere,
        select: {
          id: true,
          employeeId: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { employeeId: 'asc' },
      }),
      prisma.attendanceRecord.findMany({
        where: attendanceWhere,
        include: {
          membership: {
            select: {
              id: true,
              employeeId: true,
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { checkInTime: 'asc' },
      }),
      currentUser.organizationId
        ? prisma.organization.findUnique({
            where: { id: currentUser.organizationId },
            select: { workStartTime: true, lateThresholdMinutes: true },
          })
        : Promise.resolve(null),
    ]);

    // Track present memberships
    const presentMembershipIds = new Set(attendanceRecords.map((r) => r.membershipId));

    const present = attendanceRecords.map((record) => ({
      employee: {
        id: record.membership.user.id,
        firstName: record.membership.user.firstName,
        lastName: record.membership.user.lastName,
        employeeId: record.membership.employeeId,
      },
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      duration: record.duration,
      status: record.status,
      checkInMethod: record.checkInMethod,
      checkOutMethod: record.checkOutMethod,
      isActive: record.isActive,
    }));

    const allEmployees = allMemberships.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      employeeId: m.employeeId,
      email: m.user.email,
      membershipId: m.id,
    }));

    const absent = allEmployees.filter((emp) => !presentMembershipIds.has(emp.membershipId));

    const totalEmployees = allEmployees.length;
    const totalPresent = presentMembershipIds.size;
    const currentlyClockedIn = attendanceRecords.filter((r) => r.status === 'CHECKED_IN').length;
    const completedShifts = attendanceRecords.filter((r) => r.status === 'CHECKED_OUT').length;

    const totalMinutesWorked = attendanceRecords
      .filter((r) => r.duration !== null)
      .reduce((sum, r) => sum + (r.duration || 0), 0);

    const avgMinutesWorked = completedShifts > 0 ? Math.round(totalMinutesWorked / completedShifts) : 0;

    let lateArrivals = 0;
    if (org?.workStartTime) {
      const [h, m] = org.workStartTime.split(':').map(Number);
      const threshold = org.lateThresholdMinutes ?? 10;
      lateArrivals = attendanceRecords.filter((r) => {
        const workStart = new Date(r.checkInTime);
        workStart.setHours(h, m, 0, 0);
        return Math.floor((r.checkInTime.getTime() - workStart.getTime()) / 60000) > threshold;
      }).length;
    }

    return {
      date: startOfDay.toISOString().split('T')[0],
      summary: {
        totalEmployees,
        totalPresent,
        totalAbsent: absent.length,
        currentlyClockedIn,
        completedShifts,
        totalHoursWorked: Math.round((totalMinutesWorked / 60) * 10) / 10,
        avgHoursWorked: Math.round((avgMinutesWorked / 60) * 10) / 10,
        attendanceRate: totalEmployees > 0 ? Math.round((totalPresent / totalEmployees) * 100) : 0,
        lateArrivals,
      },
      present,
      absent,
    };
  }

  /**
   * Weekly attendance report
   */
  async getWeeklyReport(startDate: Date, currentUser: JWTPayload, branchIdFilter?: string) {
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);

    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const membershipWhere: Record<string, unknown> = {
      isActive: true,
      leftAt: null,
      role: 'EMPLOYEE',
      ...branchWhere(scope),
    };
    const attendanceWhere: Record<string, unknown> = {
      checkInTime: { gte: startDate, lte: endDate },
      ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
    };

    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      membershipWhere.organizationId = currentUser.organizationId;
      attendanceWhere.organizationId = currentUser.organizationId;
    }

    const [allMemberships, attendanceRecords] = await Promise.all([
      prisma.orgMembership.findMany({
        where: membershipWhere,
        select: {
          id: true,
          employeeId: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { employeeId: 'asc' },
      }),
      prisma.attendanceRecord.findMany({
        where: attendanceWhere,
        include: {
          membership: {
            select: {
              id: true,
              employeeId: true,
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { checkInTime: 'asc' },
      }),
    ]);

    const allEmployees = allMemberships.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      employeeId: m.employeeId,
      membershipId: m.id,
    }));

    const employeeStats = allEmployees.map((emp) => {
      const empRecords = attendanceRecords.filter((r) => r.membershipId === emp.membershipId);
      const completedRecords = empRecords.filter((r) => r.duration !== null);
      const totalMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
      const daysPresent = new Set(empRecords.map((r) => r.checkInTime.toISOString().split('T')[0])).size;

      return {
        employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, employeeId: emp.employeeId },
        daysPresent,
        totalShifts: empRecords.length,
        completedShifts: completedRecords.length,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        avgHoursPerDay: daysPresent > 0 ? Math.round((totalMinutes / daysPresent / 60) * 10) / 10 : 0,
      };
    });

    employeeStats.sort((a, b) => b.totalMinutes - a.totalMinutes);

    const dailyBreakdown = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);
      const dayStr = day.toISOString().split('T')[0];

      const dayRecords = attendanceRecords.filter((r) => r.checkInTime.toISOString().split('T')[0] === dayStr);
      const presentCount = new Set(dayRecords.map((r) => r.membershipId)).size;
      const totalMinutes = dayRecords.filter((r) => r.duration !== null).reduce((sum, r) => sum + (r.duration || 0), 0);

      dailyBreakdown.push({
        date: dayStr,
        dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
        presentCount,
        absentCount: allEmployees.length - presentCount,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      });
    }

    const totalMinutesAll = employeeStats.reduce((sum, e) => sum + e.totalMinutes, 0);
    const totalDaysPresent = employeeStats.reduce((sum, e) => sum + e.daysPresent, 0);
    const withAttendance = employeeStats.filter((e) => e.daysPresent > 0).length;

    return {
      weekStart: startDate.toISOString().split('T')[0],
      weekEnd: endDate.toISOString().split('T')[0],
      summary: {
        totalEmployees: allEmployees.length,
        employeesWithAttendance: withAttendance,
        totalHoursWorked: Math.round((totalMinutesAll / 60) * 10) / 10,
        avgHoursPerEmployee: withAttendance > 0 ? Math.round((totalMinutesAll / withAttendance / 60) * 10) / 10 : 0,
        avgDaysPerEmployee: withAttendance > 0 ? Math.round((totalDaysPresent / withAttendance) * 10) / 10 : 0,
      },
      dailyBreakdown,
      employeeStats,
    };
  }

  /**
   * Monthly attendance report — includes weeklyBreakdown for frontend
   */
  async getMonthlyReport(
    year: number,
    month: number,
    currentUser: JWTPayload,
    branchIdFilter?: string,
  ) {
    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);
    const daysInMonth = endDate.getDate();

    const scope = resolveBranchFilter(currentUser, branchIdFilter);
    const membershipWhere: Record<string, unknown> = {
      isActive: true,
      leftAt: null,
      role: 'EMPLOYEE',
      ...branchWhere(scope),
    };
    const attendanceWhere: Record<string, unknown> = {
      checkInTime: { gte: startDate, lte: endDate },
      ...(scope.branchId ? { membership: { branchId: scope.branchId } } : {}),
    };

    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      membershipWhere.organizationId = currentUser.organizationId;
      attendanceWhere.organizationId = currentUser.organizationId;
    }

    const [allMemberships, attendanceRecords] = await Promise.all([
      prisma.orgMembership.findMany({
        where: membershipWhere,
        select: {
          id: true,
          employeeId: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { employeeId: 'asc' },
      }),
      prisma.attendanceRecord.findMany({
        where: attendanceWhere,
        include: {
          membership: {
            select: {
              id: true,
              employeeId: true,
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { checkInTime: 'asc' },
      }),
    ]);

    const allEmployees = allMemberships.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      employeeId: m.employeeId,
      membershipId: m.id,
    }));

    // Employee stats
    const employeeStats = allEmployees.map((emp) => {
      const empRecords = attendanceRecords.filter((r) => r.membershipId === emp.membershipId);
      const completedRecords = empRecords.filter((r) => r.duration !== null);
      const totalMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
      const daysPresent = new Set(empRecords.map((r) => r.checkInTime.toISOString().split('T')[0])).size;

      return {
        employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, employeeId: emp.employeeId },
        daysPresent,
        daysAbsent: daysInMonth - daysPresent,
        attendanceRate: Math.round((daysPresent / daysInMonth) * 100),
        totalShifts: empRecords.length,
        completedShifts: completedRecords.length,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        avgHoursPerDay: daysPresent > 0 ? Math.round((totalMinutes / daysPresent / 60) * 10) / 10 : 0,
      };
    });

    employeeStats.sort((a, b) => b.totalMinutes - a.totalMinutes);

    // Weekly breakdown — split the month into weeks
    const weeklyBreakdown = this.computeWeeklyBreakdown(startDate, endDate, attendanceRecords);

    const totalMinutesAll = employeeStats.reduce((sum, e) => sum + e.totalMinutes, 0);
    const totalDaysPresent = employeeStats.reduce((sum, e) => sum + e.daysPresent, 0);
    const withAttendance = employeeStats.filter((e) => e.daysPresent > 0).length;
    const avgAttendanceRate = employeeStats.length > 0
      ? Math.round(employeeStats.reduce((sum, e) => sum + e.attendanceRate, 0) / employeeStats.length)
      : 0;

    return {
      year,
      month,
      monthName: startDate.toLocaleDateString('en-US', { month: 'long' }),
      daysInMonth,
      summary: {
        totalEmployees: allEmployees.length,
        employeesWithAttendance: withAttendance,
        totalHoursWorked: Math.round((totalMinutesAll / 60) * 10) / 10,
        avgHoursPerEmployee: withAttendance > 0 ? Math.round((totalMinutesAll / withAttendance / 60) * 10) / 10 : 0,
        avgDaysPerEmployee: withAttendance > 0 ? Math.round((totalDaysPresent / withAttendance) * 10) / 10 : 0,
        avgAttendanceRate,
      },
      weeklyBreakdown,
      employeeStats,
    };
  }

  // ======== Private helpers ========

  private computeWeeklyBreakdown(
    monthStart: Date,
    monthEnd: Date,
    attendanceRecords: Array<{ membershipId: string; checkInTime: Date; duration: number | null }>
  ) {
    const weeks: Array<{
      week: number;
      startDate: string;
      endDate: string;
      employeesPresent: number;
      totalHours: number;
    }> = [];

    let weekNum = 1;
    let current = new Date(monthStart);

    while (current <= monthEnd) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Clamp to month boundaries
      if (weekEnd > monthEnd) {
        weekEnd.setTime(monthEnd.getTime());
      }

      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Filter records for this week
      const weekRecords = attendanceRecords.filter((r) => {
        const recordDate = r.checkInTime.toISOString().split('T')[0];
        return recordDate >= weekStartStr && recordDate <= weekEndStr;
      });

      const employeesPresent = new Set(weekRecords.map((r) => r.membershipId)).size;
      const totalMinutes = weekRecords
        .filter((r) => r.duration !== null)
        .reduce((sum, r) => sum + (r.duration || 0), 0);

      weeks.push({
        week: weekNum,
        startDate: weekStartStr,
        endDate: weekEndStr,
        employeesPresent,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      });

      // Move to next week
      current.setDate(current.getDate() + 7);
      weekNum++;
    }

    return weeks;
  }
}

export const reportService = new ReportService();