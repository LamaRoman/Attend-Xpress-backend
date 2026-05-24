// ============================================================
// COMPLETE SEED FILE — Smart Attendance
// Covers all models needed for full testing of both mobile apps
// Run: npx prisma db seed
// ============================================================

import {
  PrismaClient,
  Role,
  AttendanceMode,
  CheckInMethod,
  AttendanceRecordStatus,
  LeaveType,
  LeaveStatus,
  PayrollStatus,
  HolidayType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { adToBS } from '../src/lib/nepali-date';

const prisma = new PrismaClient();

// ============================================================
// HELPERS
// ============================================================

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function setTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function isSaturday(date: Date): boolean {
  return date.getDay() === 6;
}


// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🌱 Seeding database...\n');

  // ============================================================
  // SEED CREDENTIALS — hardcoded for local dev/testing only.
  // ============================================================
  const superAdminEmail = 'admin@smartattendance.com';
  const superAdminPassword = 'Admin@1234';
  const orgAdminPassword = 'OrgAdmin@1234';
  const employeePassword = 'Employee@1234';
  const employeePin = '1234';

  // ============================================================
  // 1. SUPER ADMIN
  // ============================================================

  let superAdmin = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: {
        email: superAdminEmail,
        password: await bcrypt.hash(superAdminPassword, 12),
        firstName: 'Super',
        lastName: 'Admin',
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });
    console.log(`✅ Super admin created: ${superAdminEmail} / ${superAdminPassword}`);
  } else {
    console.log(`⏭  Super admin already exists: ${superAdminEmail}`);
  }

  // ============================================================
  // 2. PRICING PLAN
  // ============================================================
  // Only the OPERATIONS plan exists; the free STARTER tier was retired.
  // Orgs no longer have a "downgrade to free" path — after the trial+grace
  // period, the subscription is SUSPENDED until payment.
  const operationsPlan = await prisma.pricingPlan.upsert({
    where: { tier: 'OPERATIONS' },
    update: {},
    create: {
      tier: 'OPERATIONS',
      displayName: 'Operations',
      description: 'Full features. Rs. 250 per employee per month.',
      pricePerEmployee: 250,
      trialDaysMonthly: 30,
      featureLeave: true,
      featureManualCorrection: true,
      featureFullPayroll: true,
      featurePayrollWorkflow: true,
      featureReports: true,
      featureNotifications: true,
      featureOnboarding: true,
      featureAuditLog: true,
      auditLogRetentionDays: 30,
      featureFileDownload: true,
      featureDownloadReports: true,
      featureDownloadPayslips: true,
      featureDownloadAuditLog: true,
      featureDownloadLeaveRecords: true,
      isActive: true,
      sortOrder: 1,
    },
  });
  console.log(`✅ Pricing plan seeded: OPERATIONS`);

  // ============================================================
  // 3. ORGANIZATION
  // ============================================================
  let org = await prisma.organization.findFirst({
    where: { name: 'Demo Company Pvt. Ltd.' },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Demo Company Pvt. Ltd.',
        slug: 'democompany',
        email: 'info@democompany.com',
        phone: '01-4123456',
        address: 'New Baneshwor, Kathmandu, Nepal',
        isActive: true,
        calendarMode: 'NEPALI',
        attendanceMode: AttendanceMode.BOTH,
        workStartTime: '10:00',
        workEndTime: '18:00',
        lateThresholdMinutes: 15,
        workingDays: '0,1,2,3,4,5',
        geofenceEnabled: false,
        officeLat: 27.7172,
        officeLng: 85.3240,
        geofenceRadius: 100,
        leaveBalanceEnabled: true,
        annualLeaveEntitlement: 18,
        sickLeaveEntitlement: 12,
        casualLeaveEntitlement: 6,
        dashainBonusPercent: 100,
        dashainBonusMonth: 6,
        earlyClockInGraceMinutes: 15,
        lateClockOutGraceMinutes: 30,
      },
    });
    console.log(`✅ Organization created: ${org.name}`);
  } else {
    console.log(`⏭  Organization already exists: ${org.name}`);
  }

  // ============================================================
  // 4. ORG SUBSCRIPTION
  // ============================================================
  const existingSub = await prisma.orgSubscription.findUnique({
    where: { organizationId: org.id },
  });

  if (!existingSub) {
    await prisma.orgSubscription.create({
      data: {
        organizationId: org.id,
        planId: operationsPlan.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        isPriceLockedForever: true,
        setupFeeWaived: true,
        setupFeeWaivedNote: 'Demo org — founding member',
        currentEmployeeCount: 5,
        assignedBy: superAdmin.id,
        assignedAt: new Date(),
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-12-31'),
      },
    });
    console.log(`✅ Subscription created: Operations (Active)`);
  } else {
    console.log(`⏭  Subscription already exists`);
  }

  // ============================================================
  // 5. SYSTEM CONFIG
  // ============================================================
  const configs = [
    { key: 'scan_cooldown_minutes', value: '2', description: 'Minutes between QR scans for same employee' },
    { key: 'max_daily_scans', value: '2', description: 'Maximum scan actions per employee per day' },
    { key: 'working_hours_per_day', value: '8', description: 'Standard working hours per day' },
    { key: 'overtime_threshold_minutes', value: '30', description: 'Minutes after shift end before overtime counts' },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { organizationId_key: { organizationId: org.id, key: cfg.key } },
      update: {},
      create: { organizationId: org.id, ...cfg },
    });
  }
  console.log(`✅ System config seeded (${configs.length} entries)`);

  // ============================================================
  // 6. ORG ADMIN
  // ============================================================
  const orgAdminEmail = 'orgadmin@democompany.com';
  let orgAdmin = await prisma.user.findUnique({ where: { email: orgAdminEmail } });

  if (!orgAdmin) {
    orgAdmin = await prisma.user.create({
      data: {
        email: orgAdminEmail,
        password: await bcrypt.hash(orgAdminPassword, 12),
        firstName: 'Ram',
        lastName: 'Sharma',
        role: Role.ORG_ADMIN,
        isActive: true,
        phone: '9841000001',
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: orgAdmin.id,
        organizationId: org.id,
        role: Role.ORG_ADMIN,
        isActive: true,
        shiftStartTime: '10:00',
        shiftEndTime: '18:00',
      },
    });
    console.log(`✅ Org admin created: ${orgAdminEmail} / ${orgAdminPassword}`);
  } else {
    console.log(`⏭  Org admin already exists: ${orgAdminEmail}`);
  }

  // ============================================================
  // 7. EMPLOYEES
  // ============================================================
  const employeeDefs = [
    { email: 'sita@democompany.com',   firstName: 'Sita',   lastName: 'Thapa',   employeeId: 'EMP-10001', salary: 35000, isMarried: false, phone: '9841000002' },
    { email: 'hari@democompany.com',   firstName: 'Hari',   lastName: 'Basnet',  employeeId: 'EMP-10002', salary: 40000, isMarried: true,  phone: '9841000003' },
    { email: 'gita@democompany.com',   firstName: 'Gita',   lastName: 'Karki',   employeeId: 'EMP-10003', salary: 30000, isMarried: false, phone: '9841000004' },
    { email: 'bikash@democompany.com', firstName: 'Bikash', lastName: 'Rai',     employeeId: 'EMP-10004', salary: 45000, isMarried: true,  phone: '9841000005' },
    { email: 'anita@democompany.com',  firstName: 'Anita',  lastName: 'Gurung',  employeeId: 'EMP-10005', salary: 38000, isMarried: false, phone: '9841000006' },
  ];

  const pinHash = await bcrypt.hash(employeePin, 12);
  const membershipMap: Record<string, string> = {}; // email -> membershipId

  for (const emp of employeeDefs) {
    let user = await prisma.user.findUnique({ where: { email: emp.email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: emp.email,
          firstName: emp.firstName,
          lastName: emp.lastName,
          password: await bcrypt.hash(employeePassword, 12),
          role: Role.EMPLOYEE,
          isActive: true,
          phone: emp.phone,
        },
      });
    }

    let membership = await prisma.orgMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    });

    if (!membership) {
      membership = await prisma.orgMembership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: Role.EMPLOYEE,
          employeeId: emp.employeeId,
          attendancePinHash: pinHash,
          isActive: true,
          shiftStartTime: '10:00',
          shiftEndTime: '18:00',
        },
      });
      console.log(`✅ Employee created: ${emp.firstName} ${emp.lastName} (${emp.employeeId})`);
    } else {
      console.log(`⏭  Employee already exists: ${emp.email}`);
    }

    membershipMap[emp.email] = membership.id;

    // Pay Settings
    const existingPay = await prisma.employeePaySettings.findUnique({
      where: { membershipId: membership.id },
    });

    if (!existingPay) {
      await prisma.employeePaySettings.create({
        data: {
          membershipId: membership.id,
          organizationId: org.id,
          basicSalary: emp.salary,
          dearnessAllowance: 2000,
          transportAllowance: 1500,
          medicalAllowance: 1000,
          otherAllowances: 0,
          overtimeRatePerHour: 200,
          ssfEnabled: true,
          employeeSsfRate: 11,
          employerSsfRate: 20,
          pfEnabled: false,
          citEnabled: false,
          tdsEnabled: true,
          isMarried: emp.isMarried,
          dashainBonusPercent: null,
        },
      });
    }
  }

  console.log(`✅ Pay settings seeded for all employees`);

  // ============================================================
  // 8. ATTENDANCE RECORDS — Last 30 working days per employee
  // ============================================================
  console.log(`\n🕐 Seeding attendance records...`);

  for (const emp of employeeDefs) {
    const membershipId = membershipMap[emp.email];
    if (!membershipId) continue;

    // Check if attendance already seeded
    const existingCount = await prisma.attendanceRecord.count({
      where: { membershipId },
    });

    if (existingCount > 0) {
      console.log(`⏭  Attendance already exists for ${emp.firstName}`);
      continue;
    }

    let daysSeeded = 0;
    let daysBack = 1;

    // Seed last 30 working days
    while (daysSeeded < 30 && daysBack < 60) {
      const day = daysAgo(daysBack);

      // Skip Saturdays (weekly holiday in Nepal)
      if (isSaturday(day)) {
        daysBack++;
        continue;
      }

      const checkIn = setTime(day, '10:00');
      // Add some variation: late arrivals
      const lateMinutes = Math.random() < 0.2 ? Math.floor(Math.random() * 30) + 5 : 0;
      checkIn.setMinutes(checkIn.getMinutes() + lateMinutes);

      const checkOut = setTime(day, '18:00');
      // Add some variation: early/late checkout
      const checkOutVariation = Math.floor(Math.random() * 60) - 30;
      checkOut.setMinutes(checkOut.getMinutes() + checkOutVariation);

      const duration = Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000);
      const bs = adToBS(checkIn);

      // Last day is today — leave as CHECKED_IN for one employee to test active state
      const isToday = daysBack === 1;
      const isFirstEmployee = emp.email === 'sita@democompany.com';
      const status: AttendanceRecordStatus =
        isToday && isFirstEmployee
          ? AttendanceRecordStatus.CHECKED_IN
          : daysSeeded === 5
          ? AttendanceRecordStatus.AUTO_CLOSED  // Simulate a missed clock-out
          : AttendanceRecordStatus.CHECKED_OUT;

      await prisma.attendanceRecord.create({
        data: {
          membershipId,
          organizationId: org.id,
          checkInTime: checkIn,
          checkOutTime: status === AttendanceRecordStatus.CHECKED_IN ? null : checkOut,
          checkInMethod: CheckInMethod.MOBILE_CHECKIN,
          checkOutMethod: status === AttendanceRecordStatus.CHECKED_IN ? null : CheckInMethod.MOBILE_CHECKIN,
          duration: status === AttendanceRecordStatus.CHECKED_IN ? null : duration,
          status,
          bsYear: bs.year,
          bsMonth: bs.month,
          bsDay: bs.day,
          notes: status === AttendanceRecordStatus.AUTO_CLOSED
            ? 'Auto-closed at midnight by system — employee did not clock out.'
            : null,
        },
      });

      daysSeeded++;
      daysBack++;
    }

    console.log(`✅ Attendance seeded for ${emp.firstName} (${daysSeeded} days)`);
  }

  // ============================================================
  // 9. LEAVE BALANCES — Current BS year 2082
  // ============================================================
  const currentBSYear = 2082;
  const orgAdminUser = await prisma.user.findUnique({ where: { email: orgAdminEmail } });

  for (const emp of employeeDefs) {
    const membershipId = membershipMap[emp.email];
    if (!membershipId) continue;

    const existingBalance = await prisma.leaveBalance.findUnique({
      where: { membershipId_bsYear: { membershipId, bsYear: currentBSYear } },
    });

    if (!existingBalance) {
      // Simulate some leaves already used
      const annualUsed = Math.floor(Math.random() * 5);
      const sickUsed = Math.floor(Math.random() * 3);
      const casualUsed = Math.floor(Math.random() * 2);

      await prisma.leaveBalance.create({
        data: {
          membershipId,
          organizationId: org.id,
          bsYear: currentBSYear,
          annualEntitlement: 18,
          sickEntitlement: 12,
          casualEntitlement: 6,
          annualCarriedOver: 5,
          sickCarriedOver: 2,
          casualCarriedOver: 0,
          annualUsed,
          sickUsed,
          casualUsed,
          initializedBy: orgAdminUser?.id,
          initializedAt: new Date(),
        },
      });
    }
  }
  console.log(`✅ Leave balances seeded for BS year ${currentBSYear}`);

  // ============================================================
  // 10. LEAVE REQUESTS
  // ============================================================
  const sitaMembershipId = membershipMap['sita@democompany.com'];
  const hariMembershipId = membershipMap['hari@democompany.com'];
  const gitaMembershipId = membershipMap['gita@democompany.com'];
  const bikashMembershipId = membershipMap['bikash@democompany.com'];
  const anitaMembershipId = membershipMap['anita@democompany.com'];

  const existingLeaves = await prisma.leave.count({ where: { organizationId: org.id } });

  if (existingLeaves === 0) {
    const leaveDefs = [
      // 2 PENDING — for admin to approve/reject in app
      {
        membershipId: sitaMembershipId,
        startDate: daysAgo(-3), // 3 days from now
        endDate: daysAgo(-5),
        type: LeaveType.ANNUAL,
        status: LeaveStatus.PENDING,
        reason: 'Family function at home village. Will be back after Dashain.',
        bsStartYear: 2082, bsStartMonth: 12, bsStartDay: 20,
        bsEndYear: 2082, bsEndMonth: 12, bsEndDay: 22,
      },
      {
        membershipId: hariMembershipId,
        startDate: daysAgo(-1),
        endDate: daysAgo(-1),
        type: LeaveType.SICK,
        status: LeaveStatus.PENDING,
        reason: 'Feeling unwell with fever. Doctor has advised rest.',
        bsStartYear: 2082, bsStartMonth: 12, bsStartDay: 18,
        bsEndYear: 2082, bsEndMonth: 12, bsEndDay: 18,
      },
      // 2 APPROVED
      {
        membershipId: gitaMembershipId,
        startDate: daysAgo(10),
        endDate: daysAgo(8),
        type: LeaveType.CASUAL,
        status: LeaveStatus.APPROVED,
        reason: 'Personal work — bank visit and vehicle registration.',
        approvedBy: orgAdminUser?.id,
        approvedAt: daysAgo(11),
        bsStartYear: 2082, bsStartMonth: 12, bsStartDay: 5,
        bsEndYear: 2082, bsEndMonth: 12, bsEndDay: 7,
      },
      {
        membershipId: bikashMembershipId,
        startDate: daysAgo(20),
        endDate: daysAgo(16),
        type: LeaveType.ANNUAL,
        status: LeaveStatus.APPROVED,
        reason: 'Annual home leave to visit parents in Dharan.',
        approvedBy: orgAdminUser?.id,
        approvedAt: daysAgo(22),
        bsStartYear: 2082, bsStartMonth: 11, bsStartDay: 25,
        bsEndYear: 2082, bsEndMonth: 11, bsEndDay: 29,
      },
      // 1 REJECTED
      {
        membershipId: anitaMembershipId,
        startDate: daysAgo(5),
        endDate: daysAgo(3),
        type: LeaveType.CASUAL,
        status: LeaveStatus.REJECTED,
        reason: 'Shopping and personal errands.',
        rejectionMessage: 'Insufficient leave balance. Please plan in advance and coordinate with team.',
        approvedBy: orgAdminUser?.id,
        approvedAt: daysAgo(6),
        bsStartYear: 2082, bsStartMonth: 12, bsStartDay: 10,
        bsEndYear: 2082, bsEndMonth: 12, bsEndDay: 12,
      },
    ];

    for (const leave of leaveDefs) {
      await prisma.leave.create({
        data: {
          membershipId: leave.membershipId,
          organizationId: org.id,
          startDate: leave.startDate,
          endDate: leave.endDate,
          type: leave.type,
          status: leave.status,
          reason: leave.reason,
          rejectionMessage: leave.rejectionMessage ?? null,
          approvedBy: leave.approvedBy ?? null,
          approvedAt: leave.approvedAt ?? null,
          bsStartYear: leave.bsStartYear,
          bsStartMonth: leave.bsStartMonth,
          bsStartDay: leave.bsStartDay,
          bsEndYear: leave.bsEndYear,
          bsEndMonth: leave.bsEndMonth,
          bsEndDay: leave.bsEndDay,
        },
      });
    }
    console.log(`✅ Leave requests seeded (2 PENDING, 2 APPROVED, 1 REJECTED)`);
  } else {
    console.log(`⏭  Leave requests already exist`);
  }

  // ============================================================
  // 11. PAYROLL RECORDS — Last 3 BS months
  // ============================================================
  const payrollMonths = [
    { adYear: 2026, adMonth: 1, bsYear: 2082, bsMonth: 9,  status: PayrollStatus.PAID },
    { adYear: 2026, adMonth: 2, bsYear: 2082, bsMonth: 10, status: PayrollStatus.APPROVED },
    { adYear: 2026, adMonth: 3, bsYear: 2082, bsMonth: 11, status: PayrollStatus.DRAFT },
  ];

  const salaryMap: Record<string, number> = {
    'sita@democompany.com':   35000,
    'hari@democompany.com':   40000,
    'gita@democompany.com':   30000,
    'bikash@democompany.com': 45000,
    'anita@democompany.com':  38000,
  };

  let payrollSeeded = 0;

  for (const emp of employeeDefs) {
    const membershipId = membershipMap[emp.email];
    if (!membershipId) continue;

    const basicSalary = salaryMap[emp.email] || 35000;

    for (const period of payrollMonths) {
      const existing = await prisma.payrollRecord.findUnique({
        where: { membershipId_bsYear_bsMonth: { membershipId, bsYear: period.bsYear, bsMonth: period.bsMonth } },
      });

      if (!existing) {
        const workingDays = 26;
        const daysPresent = Math.floor(Math.random() * 4) + 23; // 23-26
        const daysAbsent = workingDays - daysPresent;

        const da = 2000;
        const ta = 1500;
        const ma = 1000;
        const grossSalary = basicSalary + da + ta + ma;

        const absenceDeduction = daysAbsent > 0
          ? Math.floor((basicSalary / workingDays) * daysAbsent)
          : 0;

        const employeeSsf = Math.floor(basicSalary * 0.11);
        const employerSsf = Math.floor(basicSalary * 0.20);
        const tds = Math.floor(grossSalary * 0.01);

        const totalDeductions = absenceDeduction + employeeSsf + tds;
        const netSalary = grossSalary - totalDeductions;

        await prisma.payrollRecord.create({
          data: {
            membershipId,
            organizationId: org.id,
            year: period.adYear,
            month: period.adMonth,
            bsYear: period.bsYear,
            bsMonth: period.bsMonth,
            workingDaysInMonth: workingDays,
            daysPresent,
            daysAbsent,
            paidLeaveDays: 0,
            unpaidLeaveDays: daysAbsent,
            basicSalary,
            dearnessAllowance: da,
            transportAllowance: ta,
            medicalAllowance: ma,
            otherAllowances: 0,
            overtimePay: 0,
            grossSalary,
            absenceDeduction,
            employeeSsf,
            employerSsf,
            employeePf: 0,
            employerPf: 0,
            citDeduction: 0,
            advanceDeduction: 0,
            dashainBonus: 0,
            isMarried: emp.isMarried,
            tds,
            otherDeductions: 0,
            totalDeductions,
            netSalary,
            status: period.status,
            processedAt: new Date(period.adYear, period.adMonth - 1, 28),
            approvedAt: period.status === PayrollStatus.APPROVED || period.status === PayrollStatus.PAID
              ? new Date(period.adYear, period.adMonth - 1, 30)
              : null,
            paidAt: period.status === PayrollStatus.PAID
              ? new Date(period.adYear, period.adMonth, 5)
              : null,
          },
        });

        payrollSeeded++;
      }
    }
  }
  console.log(`✅ Payroll records seeded (${payrollSeeded} records — PAID, APPROVED, DRAFT)`);

  // ============================================================
  // 12. NEPAL PUBLIC HOLIDAYS — BS 2082
  // ============================================================
  const holidays = [
    { name: 'New Year (Nawa Barsha)', nameNepali: 'नव वर्ष', bsYear: 2082, bsMonth: 1,  bsDay: 1,  type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Labour Day',             nameNepali: 'श्रमिक दिवस', bsYear: 2082, bsMonth: 1,  bsDay: 18, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Republic Day',           nameNepali: 'गणतन्त्र दिवस', bsYear: 2082, bsMonth: 2,  bsDay: 15, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Constitution Day',       nameNepali: 'संविधान दिवस', bsYear: 2082, bsMonth: 6,  bsDay: 3,  type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Dashain (Ghatasthapana)', nameNepali: 'घटस्थापना', bsYear: 2082, bsMonth: 6, bsDay: 21, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Dashain (Vijaya Dashami)', nameNepali: 'विजया दशमी', bsYear: 2082, bsMonth: 6, bsDay: 30, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Tihar (Laxmi Puja)',      nameNepali: 'लक्ष्मी पूजा', bsYear: 2082, bsMonth: 7, bsDay: 15, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Tihar (Mha Puja)',        nameNepali: 'म्ह पूजा',    bsYear: 2082, bsMonth: 7, bsDay: 16, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Tihar (Bhai Tika)',       nameNepali: 'भाई टीका',   bsYear: 2082, bsMonth: 7, bsDay: 17, type: HolidayType.PUBLIC_HOLIDAY },
    { name: 'Christmas Day',           nameNepali: 'क्रिसमस',    bsYear: 2082, bsMonth: 9, bsDay: 10, type: HolidayType.PUBLIC_HOLIDAY },
  ];

  let holidaysSeeded = 0;
  for (const h of holidays) {
    const existing = await prisma.holiday.findFirst({
      where: { bsYear: h.bsYear, bsMonth: h.bsMonth, bsDay: h.bsDay, organizationId: null },
    });

    if (!existing) {
      // Convert BS to AD for the date field
      const { bsToAD } = await import('../src/lib/nepali-date');
      const adDate = bsToAD({ year: h.bsYear, month: h.bsMonth, day: h.bsDay });

      await prisma.holiday.create({
        data: {
          organizationId: null, // National holiday — applies to all orgs
          name: h.name,
          nameNepali: h.nameNepali,
          date: adDate,
          bsYear: h.bsYear,
          bsMonth: h.bsMonth,
          bsDay: h.bsDay,
          type: h.type,
          isRecurring: false,
          isActive: true,
        },
      });
      holidaysSeeded++;
    }
  }
  console.log(`✅ Holidays seeded (${holidaysSeeded} public holidays for BS 2082)`);

  // ============================================================
  // 13. DOCUMENT TYPES
  // ============================================================
  const docTypes = [
    { name: 'Citizenship Certificate', nameNp: 'नागरिकता प्रमाणपत्र', isRequired: true },
    { name: 'PAN Card', nameNp: 'प्यान कार्ड', isRequired: true },
    { name: 'Appointment Letter', nameNp: 'नियुक्ति पत्र', isRequired: true },
    { name: 'Employment Contract', nameNp: 'रोजगार सम्झौता', isRequired: false },
    { name: 'Academic Certificate', nameNp: 'शैक्षिक प्रमाणपत्र', isRequired: false },
  ];

  for (const dt of docTypes) {
    const existing = await prisma.documentType.findFirst({
      where: { organizationId: org.id, name: dt.name },
    });

    if (!existing) {
      await prisma.documentType.create({
        data: {
          organizationId: org.id,
          name: dt.name,
          nameNp: dt.nameNp,
          isRequired: dt.isRequired,
          isActive: true,
        },
      });
    }
  }
  console.log(`✅ Document types seeded (${docTypes.length} types)`);

  // ============================================================
  // 14. PLATFORM CONFIG
  // ============================================================
  const platformConfigs = [
    { key: 'trial_duration_days', value: '30', valueType: 'number', label: 'Trial Duration (Days)', description: 'Default trial period for new orgs' },
    { key: 'ssf_employee_rate', value: '11', valueType: 'number', label: 'SSF Employee Rate (%)', description: 'Default SSF employee contribution rate' },
    { key: 'ssf_employer_rate', value: '20', valueType: 'number', label: 'SSF Employer Rate (%)', description: 'Default SSF employer contribution rate' },
  ];

  for (const pc of platformConfigs) {
    const existing = await prisma.platformConfig.findUnique({ where: { key: pc.key } });
    if (!existing) {
      await prisma.platformConfig.create({ data: pc });
    }
  }
  console.log(`✅ Platform config seeded (${platformConfigs.length} entries)`);

  // ============================================================
  // 15. SECOND ORG — for cross-org pentest probes
  // ============================================================
  // Minimal data: just users + memberships + an Operations trial
  // subscription. No attendance/leaves/payroll for OrgB — cross-org probes
  // target democompany's records (OrgB users trying to read OrgA data).
  let otherOrg = await prisma.organization.findFirst({
    where: { name: 'Other Company Pvt. Ltd.' },
  });

  if (!otherOrg) {
    otherOrg = await prisma.organization.create({
      data: {
        name: 'Other Company Pvt. Ltd.',
        slug: 'othercompany',
        email: 'info@othercompany.com',
        phone: '01-4999999',
        address: 'Lalitpur, Nepal',
        isActive: true,
        calendarMode: 'NEPALI',
        attendanceMode: AttendanceMode.BOTH,
        workStartTime: '10:00',
        workEndTime: '18:00',
        lateThresholdMinutes: 15,
        workingDays: '0,1,2,3,4,5',
        geofenceEnabled: false,
        officeLat: 27.6710,
        officeLng: 85.3250,
        geofenceRadius: 100,
        leaveBalanceEnabled: true,
        annualLeaveEntitlement: 18,
        sickLeaveEntitlement: 12,
        casualLeaveEntitlement: 6,
        dashainBonusPercent: 100,
        dashainBonusMonth: 6,
        earlyClockInGraceMinutes: 15,
        lateClockOutGraceMinutes: 30,
      },
    });
    console.log(`✅ Second organization created: ${otherOrg.name}`);
  } else {
    console.log(`⏭  Second organization already exists: ${otherOrg.name}`);
  }

  // Subscription for OrgB: OPERATIONS on a fresh 30-day trial.
  // (The legacy STARTER free tier was retired; new orgs all start on a paid
  // plan with a trial period rather than a permanent free tier.)
  const otherSub = await prisma.orgSubscription.findUnique({
    where: { organizationId: otherOrg.id },
  });

  if (!otherSub) {
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.orgSubscription.create({
      data: {
        organizationId: otherOrg.id,
        planId: operationsPlan.id,
        status: 'TRIALING',
        billingCycle: 'MONTHLY',
        isPriceLockedForever: false,
        setupFeeWaived: true,
        setupFeeWaivedNote: 'Cross-org pentest target',
        currentEmployeeCount: 1,
        assignedBy: superAdmin.id,
        assignedAt: new Date(),
        trialStartedAt,
        trialEndsAt,
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-12-31'),
      },
    });
    console.log(`✅ Second subscription created: Operations (Trialing)`);
  }

  // OrgB org admin
  const otherAdminEmail = 'orgadmin@othercompany.com';
  let otherAdmin = await prisma.user.findUnique({ where: { email: otherAdminEmail } });

  if (!otherAdmin) {
    otherAdmin = await prisma.user.create({
      data: {
        email: otherAdminEmail,
        password: await bcrypt.hash(orgAdminPassword, 12),
        firstName: 'Krishna',
        lastName: 'Thapa',
        role: Role.ORG_ADMIN,
        isActive: true,
        phone: '9841999001',
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: otherAdmin.id,
        organizationId: otherOrg.id,
        role: Role.ORG_ADMIN,
        isActive: true,
        shiftStartTime: '10:00',
        shiftEndTime: '18:00',
      },
    });
    console.log(`✅ OrgB admin created: ${otherAdminEmail} / ${orgAdminPassword}`);
  } else {
    console.log(`⏭  OrgB admin already exists`);
  }

  // OrgB employee
  const otherEmpEmail = 'ram@othercompany.com';
  let otherEmp = await prisma.user.findUnique({ where: { email: otherEmpEmail } });

  if (!otherEmp) {
    otherEmp = await prisma.user.create({
      data: {
        email: otherEmpEmail,
        password: await bcrypt.hash(employeePassword, 12),
        firstName: 'Ram',
        lastName: 'Bahadur',
        role: Role.EMPLOYEE,
        isActive: true,
        phone: '9841999002',
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: otherEmp.id,
        organizationId: otherOrg.id,
        role: Role.EMPLOYEE,
        isActive: true,
        shiftStartTime: '10:00',
        shiftEndTime: '18:00',
      },
    });
    console.log(`✅ OrgB employee created: ${otherEmpEmail} / ${employeePassword}`);
  } else {
    console.log(`⏭  OrgB employee already exists`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n🎉 Seeding complete!\n');
  console.log('='.repeat(50));
  console.log('LOGIN CREDENTIALS');
  console.log('='.repeat(50));
  console.log(`Super Admin:  ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`Org Admin:    orgadmin@democompany.com / ${orgAdminPassword}`);
  console.log(`Employee:     sita@democompany.com / ${employeePassword} / PIN: ${employeePin}`);
  console.log(`Employee:     hari@democompany.com / ${employeePassword} / PIN: ${employeePin}`);
  console.log(`Employee:     gita@democompany.com / ${employeePassword} / PIN: ${employeePin}`);
  console.log(`Employee:     bikash@democompany.com / ${employeePassword} / PIN: ${employeePin}`);
  console.log(`Employee:     anita@democompany.com / ${employeePassword} / PIN: ${employeePin}`);
  console.log('='.repeat(50));
  console.log('WHAT WAS SEEDED');
  console.log('='.repeat(50));
  console.log('✅ 1 Super Admin');
  console.log('✅ 2 Pricing Plans (Starter, Operations)');
  console.log('✅ 1 Organization (Demo Company Pvt. Ltd.)');
  console.log('✅ 1 Active Subscription (Operations)');
  console.log('✅ 4 System Config entries');
  console.log('✅ 1 Org Admin');
  console.log(`✅ 5 Employees with PIN: ${employeePin}`);
  console.log('✅ 5 Pay Settings (realistic Nepal salaries)');
  console.log('✅ Attendance Records (30 working days per employee)');
  console.log('✅ Leave Balances (BS 2082)');
  console.log('✅ 5 Leave Requests (2 PENDING, 2 APPROVED, 1 REJECTED)');
  console.log('✅ Payroll Records (3 months — PAID, APPROVED, DRAFT)');
  console.log('✅ 10 Nepal Public Holidays (BS 2082)');
  console.log('✅ 5 Document Types');
  console.log('✅ 4 Platform Config entries');
  console.log('='.repeat(50));
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });