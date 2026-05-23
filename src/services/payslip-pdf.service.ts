import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

const BS_MONTHS_EN = ['Baisakh', 'Jestha', 'Ashar', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

interface PayslipData {
  orgName: string;
  orgAddress?: string;
  employee: { firstName: string; lastName: string; employeeId: string; email?: string };
  bsYear: number;
  bsMonth: number;
  workingDaysInMonth: number;
  holidaysInMonth: number;
  daysPresent: number;
  daysAbsent: number;
  overtimeHours: number;
  basicSalary: number;
  dearnessAllowance: number;
  transportAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  overtimePay: number;
  grossSalary: number;
  absenceDeduction: number;
  employeeSsf: number;
  employerSsf: number;
  employeePf: number;
  employerPf: number;
  citDeduction: number;
  advanceDeduction: number;
  dashainBonus: number;
  tds: number;
  totalDeductions: number;
  netSalary: number;
  isMarried: boolean;
  status: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function docNumber(bsYear: number, bsMonth: number, empId: string): string {
  const m = String(bsMonth).padStart(2, '0');
  const id = (empId || 'EMP').replace(/\W/g, '').toUpperCase().slice(0, 4);
  return `${bsYear}${m}${id}${Date.now().toString().slice(-4)}`;
}

export function generatePayslipPDF(data: PayslipData): PassThrough {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = new PassThrough();
  doc.pipe(stream);

  const W = 515;
  const L = 40;
  let y = 40;

  // Colors
  const PRIMARY = '#1e40af';   // deep blue
  const ACCENT = '#06b6d4';    // cyan
  const TEXT = '#1f2937';      // gray-900
  const MUTED = '#6b7280';     // gray-500
  const BG_LIGHT = '#f9fafb';  // gray-50
  const BORDER = '#e5e7eb';    // gray-200
  const SUCCESS = '#10b981';   // emerald
  const DANGER = '#ef4444';    // red

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // HEADER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  // Company name
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(22)
    .text(data.orgName, L, y);
  y += 28;

  if (data.orgAddress) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(data.orgAddress, L, y);
    y += 14;
  }

  // Payslip title + document number
  y += 8;
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(14)
    .text('SALARY SLIP', L, y);
  
  const docNo = docNumber(data.bsYear, data.bsMonth, data.employee.employeeId);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('Document #' + docNo, L + W - 140, y + 3, { width: 140, align: 'right' });
  
  y += 26;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 20;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EMPLOYEE & PERIOD INFO (side by side)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  const leftCol = L;
  const rightCol = L + W / 2 + 20;
  
  // Left: Employee
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
    .text('EMPLOYEE INFORMATION', leftCol, y);
  y += 14;
  
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12)
    .text(data.employee.firstName + ' ' + data.employee.lastName, leftCol, y);
  y += 16;
  
  doc.fillColor(TEXT).font('Helvetica').fontSize(9)
    .text('ID: ' + data.employee.employeeId, leftCol, y);
  y += 12;
  
  if (data.employee.email) {
    doc.fillColor(MUTED).fontSize(8.5).text(data.employee.email, leftCol, y);
  }
  
  // Right: Pay period
  let ry = y - 42;
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
    .text('PAY PERIOD', rightCol, ry);
  ry += 14;
  
  const monthEN = BS_MONTHS_EN[data.bsMonth - 1];
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12)
    .text(`${monthEN} ${data.bsYear}`, rightCol, ry);
  ry += 16;
  
  // Status
  const statusColor = data.status === 'APPROVED' ? SUCCESS : data.status === 'PAID' ? PRIMARY : '#f59e0b';
  doc.roundedRect(rightCol, ry, 68, 18, 3).fill(statusColor);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
    .text(data.status.toUpperCase(), rightCol, ry + 5, { width: 68, align: 'center' });

  y += 40;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 20;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ATTENDANCE SUMMARY (horizontal cards)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
    .text('ATTENDANCE', L, y);
  y += 16;

  const attW = (W - 32) / 5;
  const attData = [
    { label: 'Working\nDays', value: data.workingDaysInMonth, color: TEXT },
    { label: 'Holidays', value: data.holidaysInMonth, color: TEXT },
    { label: 'Present', value: data.daysPresent, color: SUCCESS },
    { label: 'Absent', value: data.daysAbsent, color: data.daysAbsent > 0 ? DANGER : TEXT },
    { label: 'Overtime\nHours', value: data.overtimeHours.toFixed(1), color: ACCENT },
  ];

  attData.forEach((item, i) => {
    const x = L + i * (attW + 8);
    doc.roundedRect(x, y, attW, 52, 4).fill(BG_LIGHT).stroke();
    doc.fillColor(item.color).font('Helvetica-Bold').fontSize(16)
      .text(String(item.value), x, y + 8, { width: attW, align: 'center' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(item.label, x, y + 30, { width: attW, align: 'center' });
  });

  y += 64;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EARNINGS & DEDUCTIONS TABLE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
    .text('SALARY BREAKDOWN', L, y);
  y += 16;

  // Table header
  doc.rect(L, y, W, 24).fill(BG_LIGHT);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5)
    .text('EARNINGS', L + 10, y + 8)
    .text('AMOUNT', L + W / 2 - 80, y + 8, { width: 70, align: 'right' })
    .text('DEDUCTIONS', L + W / 2 + 10, y + 8)
    .text('AMOUNT', L + W - 80, y + 8, { width: 70, align: 'right' });
  y += 24;

  // Prepare data
  const earnings: [string, number][] = [
    ['Basic Salary', data.basicSalary],
    ['Dearness Allowance', data.dearnessAllowance],
    ['Transport Allowance', data.transportAllowance],
    ['Medical Allowance', data.medicalAllowance],
    ['Other Allowances', data.otherAllowances],
    ['Overtime Pay', data.overtimePay],
    ['Dashain Bonus', data.dashainBonus],
  ].filter(([, v]) => Number(v) > 0) as [string, number][];

  const deductions: [string, number][] = [
    ['Absence Deduction', data.absenceDeduction],
    ['SSF (Employee)', data.employeeSsf],
    ['PF (Employee)', data.employeePf],
    ['CIT', data.citDeduction],
    ['TDS', data.tds],
    ['Advance/Loan', data.advanceDeduction],
  ].filter(([, v]) => Number(v) > 0) as [string, number][];

  const maxRows = Math.max(earnings.length, deductions.length);
  
  for (let i = 0; i < maxRows; i++) {
    const rowY = y;
    
    // Earnings row
    if (i < earnings.length) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(earnings[i][0], L + 10, rowY + 6, { width: W / 2 - 90 });
      doc.fillColor(TEXT).text('Rs. ' + fmt(earnings[i][1]), L + W / 2 - 80, rowY + 6, { width: 70, align: 'right' });
    }
    
    // Deductions row
    if (i < deductions.length) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(deductions[i][0], L + W / 2 + 10, rowY + 6, { width: W / 2 - 90 });
      doc.fillColor(DANGER).text('Rs. ' + fmt(deductions[i][1]), L + W - 80, rowY + 6, { width: 70, align: 'right' });
    }
    
    y += 20;
    if (i < maxRows - 1) {
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    }
  }

  y += 6;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 10;

  // Totals row
  doc.rect(L, y, W, 28).fill(BG_LIGHT);
  doc.fillColor(SUCCESS).font('Helvetica-Bold').fontSize(10)
    .text('Gross Earnings', L + 10, y + 8);
  doc.text('Rs. ' + fmt(data.grossSalary + (data.dashainBonus || 0)), L + W / 2 - 80, y + 8, { width: 70, align: 'right' });
  
  doc.fillColor(DANGER).font('Helvetica-Bold').fontSize(10)
    .text('Total Deductions', L + W / 2 + 10, y + 8);
  doc.text('Rs. ' + fmt(data.totalDeductions), L + W - 80, y + 8, { width: 70, align: 'right' });
  y += 36;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EMPLOYER CONTRIBUTIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  if (data.employerSsf > 0 || data.employerPf > 0) {
    doc.roundedRect(L, y, W, 56, 6).fill('#eff6ff');
    doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(8)
      .text('EMPLOYER CONTRIBUTIONS (not deducted from your salary)', L + 12, y + 10);
    y += 26;

    let ex = L + 12;
    if (data.employerSsf > 0) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text('SSF Employer (20%)', ex, y);
      doc.font('Helvetica-Bold').fontSize(10)
        .text('Rs. ' + fmt(data.employerSsf), ex, y + 14);
      ex += 160;
    }
    if (data.employerPf > 0) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text('PF Employer (10%)', ex, y);
      doc.font('Helvetica-Bold').fontSize(10)
        .text('Rs. ' + fmt(data.employerPf), ex, y + 14);
    }
    y += 40;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // NET SALARY BOX
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  doc.roundedRect(L, y, W, 64, 8).fill(PRIMARY);
  doc.fillColor('#93c5fd').font('Helvetica').fontSize(9)
    .text('NET SALARY PAYABLE', L + 16, y + 14);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26)
    .text('Rs. ' + fmt(data.netSalary), L + 16, y + 28);
  
  if (data.isMarried) {
    doc.fillColor('#93c5fd').font('Helvetica').fontSize(7)
      .text('Married tax bracket (Rs. 6,00,000 @ 1%)', L + 16, y + 54);
  }
  
  y += 76;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // BANK DETAILS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  if (data.bankName || data.bankAccountNumber) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
      .text('BANK DETAILS', L, y);
    y += 14;
    
    if (data.bankName) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text('Bank: ' + data.bankName, L, y);
      y += 12;
    }
    if (data.bankAccountName) {
      doc.fillColor(TEXT).fontSize(9)
        .text('Account Name: ' + data.bankAccountName, L, y);
      y += 12;
    }
    if (data.bankAccountNumber) {
      doc.fillColor(TEXT).fontSize(9)
        .text('Account Number: ' + data.bankAccountNumber, L, y);
      y += 12;
    }
    y += 8;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FOOTER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 10;
  
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7)
    .text(
      `This is a computer-generated payslip. Generated on ${generated} --¢ Document #${docNo}`,
      L, y, { width: W, align: 'center' }
    );

  doc.end();
  return stream;
}
