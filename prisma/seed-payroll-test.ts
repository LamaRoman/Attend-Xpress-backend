import { PrismaClient, PayrollStatus } from '@prisma/client';

const prisma = new PrismaClient();

// BS month to AD month/year conversion (approximate — good enough for seeding)
function bsToAdYear(bsYear: number, bsMonth: number): { year: number; month: number } {
  // BS year is roughly AD year + 56/57
  // Baisakh (month 1) starts mid-April
  const adYear = bsMonth >= 1 && bsMonth <= 9 ? bsYear - 57 : bsYear - 56;
  const adMonth = ((bsMonth + 2) % 12) + 1;
  return { year: adYear, month: adMonth };
}

function makeRecord(
  userId: string,
  organizationId: string,
  bsYear: number,
  bsMonth: number,
  basicSalary: number
) {
  const { year, month } = bsToAdYear(bsYear, bsMonth);
  const dearness = 2000;
  const transport = 1500;
  const medical = 1000;
  const gross = basicSalary + dearness + transport + medical;
  const employeeSsf = Math.round(gross * 0.11 * 100) / 100;
  const employeePf = 0;
  const tds = Math.round(gross * 0.01 * 100) / 100;
  const totalDeductions = employeeSsf + employeePf + tds;
  const netSalary = Math.round((gross - totalDeductions) * 100) / 100;

  return {
    userId,
    organizationId,
    year,
    month,
    bsYear,
    bsMonth,
    workingDaysInMonth: 26,
    holidaysInMonth: 0,
    daysPresent: 26,
    daysAbsent: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    overtimeHours: 0,
    basicSalary,
    dearnessAllowance: dearness,
    transportAllowance: transport,
    medicalAllowance: medical,
    otherAllowances: 0,
    overtimePay: 0,
    grossSalary: gross,
    absenceDeduction: 0,
    employeeSsf,
    employerSsf: Math.round(gross * 0.20 * 100) / 100,
    employeePf,
    employerPf: 0,
    citDeduction: 0,
    advanceDeduction: 0,
    dashainBonus: 0,
    isMarried: false,
    tds,
    otherDeductions: 0,
    totalDeductions,
    netSalary,
    status: PayrollStatus.PAID,
  };
}

async function main() {
  console.log('🌱 Seeding payroll test records...\n');

  const org = await prisma.organization.findFirst({
    where: { name: 'Demo Company Pvt. Ltd.' },
  });
  if (!org) {
    console.error('❌ Demo org not found. Run the main seed first.');
    process.exit(1);
  }

  const employees = await prisma.user.findMany({
    where: { organizationId: org.id, role: 'EMPLOYEE' },
    orderBy: { firstName: 'asc' },
  });

  if (employees.length === 0) {
    console.error('❌ No employees found. Run the main seed first.');
    process.exit(1);
  }

  // Different start years to test the dynamic dropdown
  // emp[0] Anita   — starts from 2079 (oldest)
  // emp[1] Bikash  — starts from 2080
  // emp[2] Gita    — starts from 2081
  // emp[3] Hari    — starts from 2082 (newest)
  // emp[4] Sita    — starts from 2079 (same as oldest)

  const scenarios: Array<{ startBsYear: number; startBsMonth: number; basicSalary: number }> = [
    { startBsYear: 2079, startBsMonth: 1,  basicSalary: 38000 },
    { startBsYear: 2080, startBsMonth: 4,  basicSalary: 45000 },
    { startBsYear: 2081, startBsMonth: 1,  basicSalary: 30000 },
    { startBsYear: 2082, startBsMonth: 1,  basicSalary: 40000 },
    { startBsYear: 2079, startBsMonth: 7,  basicSalary: 35000 },
  ];

  const currentBsYear = 2082;
  const currentBsMonth = 4; // approximate current month

  let totalCreated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const scenario = scenarios[i] || scenarios[0];

    console.log(`\n👤 ${emp.firstName} ${emp.lastName} — starts BS ${scenario.startBsYear}/${scenario.startBsMonth}`);

    let bsYear = scenario.startBsYear;
    let bsMonth = scenario.startBsMonth;

    while (
      bsYear < currentBsYear ||
      (bsYear === currentBsYear && bsMonth <= currentBsMonth)
    ) {
      const record = makeRecord(emp.id, org.id, bsYear, bsMonth, scenario.basicSalary);

      const existing = await prisma.payrollRecord.findUnique({
        where: { userId_bsYear_bsMonth: { userId: emp.id, bsYear, bsMonth } },
      });

      if (!existing) {
        await prisma.payrollRecord.create({ data: record });
        console.log(`  ✓ Created BS ${bsYear}/${bsMonth}`);
        totalCreated++;
      } else {
        console.log(`  — Skipped BS ${bsYear}/${bsMonth} (exists)`);
        totalSkipped++;
      }

      bsMonth++;
      if (bsMonth > 12) {
        bsMonth = 1;
        bsYear++;
      }
    }
  }

  console.log(`\n✅ Done — ${totalCreated} created, ${totalSkipped} skipped`);
  console.log('\nTest logins:');
  employees.forEach((e, i) => {
    const s = scenarios[i] || scenarios[0];
    console.log(`  ${e.firstName} ${e.lastName} (${e.email}) — earliest year: BS ${s.startBsYear}`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
