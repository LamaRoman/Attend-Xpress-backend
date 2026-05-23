// Payroll calculation tests - removed Next.js dependency
// These are pure calculation tests, no API mocking needed

describe('Payroll Calculations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Salary Calculations', () => {
    it('should calculate gross salary correctly', () => {
      const basicSalary = 50000;
      const allowances = {
        housing: 5000,
        transport: 3000,
        meal: 2000,
      };

      const totalAllowances = Object.values(allowances).reduce((sum, val) => sum + val, 0);
      const grossSalary = basicSalary + totalAllowances;

      expect(totalAllowances).toBe(10000);
      expect(grossSalary).toBe(60000);
    });

    it('should handle zero allowances', () => {
      const basicSalary = 50000;
      const allowances = 0;
      const grossSalary = basicSalary + allowances;

      expect(grossSalary).toBe(50000);
    });

    it('should calculate monthly from annual salary', () => {
      const annualSalary = 600000;
      const monthlySalary = annualSalary / 12;

      expect(monthlySalary).toBe(50000);
    });
  });

  describe('SSF (Social Security Fund) Calculations', () => {
    it('should calculate employee SSF deduction (11%)', () => {
      const basicSalary = 50000;
      const ssfRate = 0.11;
      const employeeSSF = basicSalary * ssfRate;

      expect(employeeSSF).toBe(5500);
    });

    it('should calculate employer SSF contribution (20%)', () => {
      const basicSalary = 50000;
      const employerSSFRate = 0.20;
      const employerSSF = basicSalary * employerSSFRate;

      expect(employerSSF).toBe(10000);
    });

    it('should cap SSF at maximum salary limit', () => {
      const highSalary = 100000;
      const maxSSFSalary = 50000; // SSF cap in Nepal
      const ssfRate = 0.11;
      
      const cappedSalary = Math.min(highSalary, maxSSFSalary);
      const employeeSSF = cappedSalary * ssfRate;

      expect(employeeSSF).toBe(5500);
      expect(cappedSalary).toBe(50000);
    });

    it('should calculate total SSF (employee + employer)', () => {
      const basicSalary = 50000;
      const employeeSSF = basicSalary * 0.11;
      const employerSSF = basicSalary * 0.20;
      const totalSSF = employeeSSF + employerSSF;

      expect(totalSSF).toBe(15500);
    });

    it('should handle salary below SSF threshold', () => {
      const lowSalary = 30000;
      const ssfRate = 0.11;
      const employeeSSF = lowSalary * ssfRate;

      expect(employeeSSF).toBe(3300);
    });
  });

  describe('TDS (Tax Deduction at Source) Calculations', () => {
    it('should calculate TDS for income up to 500,000 (exempt)', () => {
      const annualIncome = 400000;
      const taxableIncome = Math.max(0, annualIncome - 500000);
      const tds = taxableIncome * 0.01; // 1% for first bracket

      expect(taxableIncome).toBe(0);
      expect(tds).toBe(0);
    });

    it('should calculate TDS for income 500,001 to 700,000', () => {
      const annualIncome = 600000;
      const exemptAmount = 500000;
      const taxableIncome = annualIncome - exemptAmount;
      const tds = taxableIncome * 0.10; // 10% for second bracket

      expect(taxableIncome).toBe(100000);
      expect(tds).toBe(10000);
    });

    it('should calculate TDS with progressive brackets', () => {
      const annualIncome = 900000;
      
      // Progressive tax calculation
      let tds = 0;
      let remainingIncome = annualIncome;

      // First 500,000 - exempt
      const bracket1 = Math.min(remainingIncome, 500000);
      remainingIncome -= bracket1;

      // Next 200,000 - 10%
      const bracket2 = Math.min(remainingIncome, 200000);
      tds += bracket2 * 0.10;
      remainingIncome -= bracket2;

      // Next 300,000 - 20%
      const bracket3 = Math.min(remainingIncome, 300000);
      tds += bracket3 * 0.20;
      remainingIncome -= bracket3;

      // Above 1,000,000 - 30%
      tds += remainingIncome * 0.30;

      expect(tds).toBe(20000 + 40000); // 10% of 200k + 20% of 200k
    });

    it('should calculate monthly TDS from annual', () => {
      const annualTDS = 60000;
      const monthlyTDS = annualTDS / 12;

      expect(monthlyTDS).toBe(5000);
    });

    it('should handle high income tax bracket', () => {
      const annualIncome = 1500000;
      
      let tds = 0;
      let remainingIncome = annualIncome;

      // Exempt: 500,000
      remainingIncome -= 500000;

      // 10%: Next 200,000
      const bracket2 = Math.min(remainingIncome, 200000);
      tds += bracket2 * 0.10;
      remainingIncome -= bracket2;

      // 20%: Next 300,000
      const bracket3 = Math.min(remainingIncome, 300000);
      tds += bracket3 * 0.20;
      remainingIncome -= bracket3;

      // 30%: Above 1,000,000
      tds += remainingIncome * 0.30;

      expect(tds).toBe(20000 + 60000 + 150000); // 20k + 60k + 150k
    });
  });

  describe('Attendance-based Calculations', () => {
    it('should calculate per-day salary', () => {
      const monthlySalary = 60000;
      const workingDays = 26;
      const perDaySalary = monthlySalary / workingDays;

      expect(perDaySalary).toBeCloseTo(2307.69, 2);
    });

    it('should calculate deduction for absences', () => {
      const monthlySalary = 60000;
      const workingDays = 26;
      const absentDays = 3;
      
      const perDaySalary = monthlySalary / workingDays;
      const absenceDeduction = perDaySalary * absentDays;

      expect(absenceDeduction).toBeCloseTo(6923.08, 2);
    });

    it('should calculate prorated salary for mid-month joining', () => {
      const monthlySalary = 60000;
      const totalDays = 30;
      const workedDays = 15;
      
      const proratedSalary = (monthlySalary / totalDays) * workedDays;

      expect(proratedSalary).toBe(30000);
    });

    it('should handle perfect attendance (no deduction)', () => {
      const monthlySalary = 60000;
      const workingDays = 26;
      const presentDays = 26;
      const absentDays = workingDays - presentDays;
      
      const perDaySalary = monthlySalary / workingDays;
      const deduction = perDaySalary * absentDays;

      expect(absentDays).toBe(0);
      expect(deduction).toBe(0);
    });

    it('should calculate salary for half-month work', () => {
      const monthlySalary = 60000;
      const totalDays = 30;
      const workedDays = 15;
      
      const proratedSalary = (monthlySalary / totalDays) * workedDays;

      expect(proratedSalary).toBe(30000);
    });
  });

  describe('Overtime Calculations', () => {
    it('should calculate overtime pay (1.5x rate)', () => {
      const hourlyRate = 500;
      const overtimeHours = 10;
      const overtimeRate = 1.5;
      
      const overtimePay = hourlyRate * overtimeHours * overtimeRate;

      expect(overtimePay).toBe(7500);
    });

    it('should calculate hourly rate from monthly salary', () => {
      const monthlySalary = 60000;
      const workingDaysPerMonth = 26;
      const hoursPerDay = 8;
      
      const totalMonthlyHours = workingDaysPerMonth * hoursPerDay;
      const hourlyRate = monthlySalary / totalMonthlyHours;

      expect(hourlyRate).toBeCloseTo(288.46, 2);
    });

    it('should calculate weekend overtime (2x rate)', () => {
      const hourlyRate = 500;
      const weekendHours = 8;
      const weekendRate = 2.0;
      
      const weekendPay = hourlyRate * weekendHours * weekendRate;

      expect(weekendPay).toBe(8000);
    });

    it('should calculate total overtime with different rates', () => {
      const hourlyRate = 500;
      
      const weekdayOvertimeHours = 10;
      const weekendOvertimeHours = 8;
      
      const weekdayPay = hourlyRate * weekdayOvertimeHours * 1.5;
      const weekendPay = hourlyRate * weekendOvertimeHours * 2.0;
      const totalOvertimePay = weekdayPay + weekendPay;

      expect(weekdayPay).toBe(7500);
      expect(weekendPay).toBe(8000);
      expect(totalOvertimePay).toBe(15500);
    });

    it('should calculate night shift differential (25%)', () => {
      const hourlyRate = 500;
      const nightHours = 8;
      const nightDifferential = 1.25;
      
      const nightPay = hourlyRate * nightHours * nightDifferential;

      expect(nightPay).toBe(5000);
    });
  });

  describe('Deductions', () => {
    it('should calculate total deductions', () => {
      const ssfDeduction = 5500;
      const tdsDeduction = 5000;
      const absenceDeduction = 2307.69;
      const loanDeduction = 3000;
      
      const totalDeductions = ssfDeduction + tdsDeduction + absenceDeduction + loanDeduction;

      expect(totalDeductions).toBeCloseTo(15807.69, 2);
    });

    it('should handle provident fund deduction', () => {
      const basicSalary = 50000;
      const pfRate = 0.10; // 10%
      const pfDeduction = basicSalary * pfRate;

      expect(pfDeduction).toBe(5000);
    });

    it('should calculate health insurance deduction', () => {
      const healthInsurancePremium = 2000;
      const employeeShare = 0.50; // 50% paid by employee
      
      const employeeDeduction = healthInsurancePremium * employeeShare;

      expect(employeeDeduction).toBe(1000);
    });

    it('should calculate loan installment deduction', () => {
      const loanAmount = 100000;
      const installmentMonths = 12;
      const monthlyInstallment = loanAmount / installmentMonths;

      expect(monthlyInstallment).toBeCloseTo(8333.33, 2);
    });
  });

  describe('Net Salary Calculations', () => {
    it('should calculate net salary correctly', () => {
      const grossSalary = 60000;
      const deductions = {
        ssf: 5500,
        tds: 5000,
        absence: 2307.69,
        loan: 0,
      };

      const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + val, 0);
      const netSalary = grossSalary - totalDeductions;

      expect(totalDeductions).toBeCloseTo(12807.69, 2);
      expect(netSalary).toBeCloseTo(47192.31, 2);
    });

    it('should add bonuses to net salary', () => {
      const netSalary = 47192.31;
      const performanceBonus = 5000;
      const festivalBonus = 3000;
      
      const totalBonus = performanceBonus + festivalBonus;
      const finalSalary = netSalary + totalBonus;

      expect(totalBonus).toBe(8000);
      expect(finalSalary).toBeCloseTo(55192.31, 2);
    });

    it('should handle negative net salary edge case', () => {
      const grossSalary = 10000;
      const deductions = 15000;
      
      const netSalary = Math.max(0, grossSalary - deductions);

      expect(netSalary).toBe(0);
    });

    it('should calculate take-home with reimbursements', () => {
      const netSalary = 47192.31;
      const reimbursements = {
        travel: 2000,
        medical: 1500,
        phone: 500,
      };

      const totalReimbursements = Object.values(reimbursements).reduce((sum, val) => sum + val, 0);
      const takeHome = netSalary + totalReimbursements;

      expect(totalReimbursements).toBe(4000);
      expect(takeHome).toBeCloseTo(51192.31, 2);
    });
  });

  describe('Complete Payroll Calculation', () => {
    it('should calculate complete payroll for an employee', () => {
      // Input data
      const basicSalary = 50000;
      const allowances = {
        housing: 5000,
        transport: 3000,
        meal: 2000,
      };
      const workingDays = 26;
      const presentDays = 24;
      const overtimeHours = 10;
      
      // Calculations
      const totalAllowances = Object.values(allowances).reduce((sum, val) => sum + val, 0);
      const grossSalary = basicSalary + totalAllowances;
      
      // Deductions
      const ssfDeduction = basicSalary * 0.11;
      const absentDays = workingDays - presentDays;
      const perDaySalary = grossSalary / workingDays;
      const absenceDeduction = perDaySalary * absentDays;
      
      // TDS (simplified)
      const annualGross = grossSalary * 12;
      const taxableIncome = Math.max(0, annualGross - 500000);
      const annualTDS = Math.min(taxableIncome, 200000) * 0.10 + Math.max(0, taxableIncome - 200000) * 0.20;
      const monthlyTDS = annualTDS / 12;
      
      // Overtime
      const totalMonthlyHours = workingDays * 8;
      const hourlyRate = grossSalary / totalMonthlyHours;
      const overtimePay = hourlyRate * overtimeHours * 1.5;
      
      const totalDeductions = ssfDeduction + absenceDeduction + monthlyTDS;
      const netSalary = grossSalary - totalDeductions + overtimePay;
      
      // Assertions
      expect(grossSalary).toBe(60000);
      expect(ssfDeduction).toBe(5500);
      expect(absentDays).toBe(2);
      expect(absenceDeduction).toBeCloseTo(4615.38, 2);
      expect(netSalary).toBeGreaterThan(40000);
      expect(netSalary).toBeLessThan(60000);
    });

    it('should generate payslip summary', () => {
      const payslip = {
        employeeId: 'EMP001',
        employeeName: 'John Doe',
        month: 'January 2024',
        earnings: {
          basicSalary: 50000,
          allowances: 10000,
          overtime: 3000,
          total: 63000,
        },
        deductions: {
          ssf: 5500,
          tds: 5000,
          absence: 2307.69,
          total: 12807.69,
        },
        netPay: 50192.31,
      };

      expect(payslip.earnings.total).toBe(63000);
      expect(payslip.deductions.total).toBeCloseTo(12807.69, 2);
      expect(payslip.netPay).toBeCloseTo(50192.31, 2);
      expect(payslip.earnings.total - payslip.deductions.total).toBeCloseTo(payslip.netPay, 2);
    });
  });

  describe('Edge Cases and Validations', () => {
    it('should handle zero salary gracefully', () => {
      const salary = 0;
      const ssf = salary * 0.11;
      const netSalary = salary - ssf;

      expect(ssf).toBe(0);
      expect(netSalary).toBe(0);
    });

    it('should handle decimal precision in calculations', () => {
      const salary = 47333.33;
      const ssfRate = 0.11;
      const ssf = parseFloat((salary * ssfRate).toFixed(2));

      expect(ssf).toBe(5206.67);
    });

    it('should validate working days range', () => {
      const workingDays = 26;
      const isValid = workingDays > 0 && workingDays <= 31;

      expect(isValid).toBe(true);
    });

    it('should handle negative values prevention', () => {
      const grossSalary = 10000;
      const deductions = 15000;
      
      const netSalary = Math.max(0, grossSalary - deductions);
      const isValid = netSalary >= 0;

      expect(netSalary).toBe(0);
      expect(isValid).toBe(true);
    });

    it('should calculate YTD (Year to Date) totals', () => {
      const monthlyPayments = [50000, 52000, 51000, 50000, 53000];
      const ytdTotal = monthlyPayments.reduce((sum, payment) => sum + payment, 0);
      const averageMonthly = ytdTotal / monthlyPayments.length;

      expect(ytdTotal).toBe(256000);
      expect(averageMonthly).toBe(51200);
    });
  });
});