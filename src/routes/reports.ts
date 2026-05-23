import { Router, Response, NextFunction } from 'express';
import { reportService } from '../services/report.service';
import { validate } from '../middleware/validate';
import { dailyReportQuerySchema, weeklyReportQuerySchema, monthlyReportQuerySchema } from '../schemas/report.schema';
import { authenticate, requireOrgAdminOrAccountant,enforceOrgIsolation, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/feature.guard';
import PDFDocument from 'pdfkit';
import prisma from '../lib/prisma';
const router = Router();


router.use(authenticate, requireOrgAdminOrAccountant, enforceOrgIsolation);
// GET /api/reports/daily
router.get('/daily', validate(dailyReportQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const data = await reportService.getDailyReport(date, req.user!, branchId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/weekly
router.get('/weekly', requireFeature('featurePayrollWorkflow'), validate(weeklyReportQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let startDate: Date;
    if (req.query.startDate) {
      startDate = new Date(req.query.startDate as string);
    } else {
      startDate = new Date();
      const day = startDate.getDay();
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
      startDate.setDate(diff);
    }
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const data = await reportService.getWeeklyReport(startDate, req.user!, branchId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/monthly
router.get('/monthly', requireFeature('featurePayrollWorkflow'), validate(monthlyReportQuerySchema, 'query'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const data = await reportService.getMonthlyReport(year, month, req.user!, branchId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/roster?period=weekly|fortnightly|monthly&includeTime=true
// Generates a printable roster PDF showing all employees' working days with actual dates
router.get('/roster', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: { message: 'Organization context required' } });

    const includeTime = req.query.includeTime === 'true';
    const period = (req.query.period as string) || 'weekly'; // weekly | fortnightly | monthly

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, workingDays: true, workStartTime: true, workEndTime: true } });
    if (!org) return res.status(404).json({ error: { message: 'Organization not found' } });

    const orgWorkingDays = org.workingDays || '0,1,2,3,4,5';
    const orgShiftStart = org.workStartTime || '10:00';
    const orgShiftEnd = org.workEndTime || '18:00';

    const memberships = await prisma.orgMembership.findMany({
      where: { organizationId, isActive: true, role: 'EMPLOYEE', deletedAt: null },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: 'asc' } },
    });

    if (memberships.length === 0) return res.status(400).json({ error: { message: 'No active employees found' } });

    const dayLabelsShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Generate date range based on period
    const today = new Date();
    const startDate = new Date(today);
    // Start from Sunday of current week
    startDate.setDate(today.getDate() - today.getDay());

    let totalDays: number;
    let periodLabel: string;
    if (period === 'monthly') {
      // Full current month
      startDate.setDate(1);
      startDate.setMonth(today.getMonth());
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      totalDays = lastDay;
      const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      periodLabel = `Monthly Duty Roster — ${monthName}`;
    } else if (period === 'fortnightly') {
      totalDays = 14;
      periodLabel = 'Fortnightly Duty Roster';
    } else {
      totalDays = 7;
      periodLabel = 'Weekly Duty Roster';
    }

    // Build dates array
    const dates: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      dates.push(d);
    }

    const dateRange = `${dates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${dates[dates.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // For monthly, split into pages of 16 days max to fit A4 landscape
    const maxColsPerPage = period === 'monthly' ? 16 : totalDays;
    const dateChunks: Date[][] = [];
    for (let i = 0; i < dates.length; i += maxColsPerPage) {
      dateChunks.push(dates.slice(i, i + maxColsPerPage));
    }

    // Build PDF
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="roster-${period}-${org.name.replace(/\s+/g, '_')}.pdf"`);
    doc.pipe(res);

    for (let chunkIdx = 0; chunkIdx < dateChunks.length; chunkIdx++) {
      const chunk = dateChunks[chunkIdx];
      if (chunkIdx > 0) doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });

      // Title
      doc.fontSize(14).font('Helvetica-Bold').text(org.name, { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(
        includeTime ? `${periodLabel} (with Shift Times)` : periodLabel,
        { align: 'center' }
      );
      doc.fontSize(8).fillColor('#64748B').text(dateRange, { align: 'center' });
      doc.fillColor('#000000').moveDown(0.4);

      // Table setup
      const startX = 30;
      const startY = doc.y + 3;
      const nameColWidth = 120;
      const idColWidth = 50;
      const numCols = chunk.length;
      const availableWidth = doc.page.width - 60 - nameColWidth - idColWidth;
      const dayColWidth = Math.min(Math.floor(availableWidth / numCols), includeTime ? 55 : 45);
      const rowHeight = includeTime ? 26 : 20;

      // Header row
      let x = startX;
      let y = startY;
      const tableWidth = nameColWidth + idColWidth + dayColWidth * numCols;
      doc.rect(x, y, tableWidth, rowHeight).fill('#0F172A');

      doc.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold');
      doc.text('Employee', x + 4, y + 3, { width: nameColWidth - 8 });
      x += nameColWidth;
      doc.text('ID', x + 4, y + 3, { width: idColWidth - 8 });
      x += idColWidth;

      for (const date of chunk) {
        const dayName = dayLabelsShort[date.getDay()];
        const dayNum = date.getDate();
        doc.text(dayName, x + 1, y + 2, { width: dayColWidth - 2, align: 'center' });
        doc.fontSize(6).text(`${dayNum}`, x + 1, y + 11, { width: dayColWidth - 2, align: 'center' });
        doc.fontSize(7);
        x += dayColWidth;
      }

      y += rowHeight;
      doc.fillColor('#000000');

      // Employee rows
      for (let i = 0; i < memberships.length; i++) {
        const m = memberships[i];
        const empWorkingDays = (m.workingDays || orgWorkingDays).split(',').map(Number);
        const empShiftStart = m.shiftStartTime || orgShiftStart;
        const empShiftEnd = m.shiftEndTime || orgShiftEnd;
        const empName = `${m.user.firstName} ${m.user.lastName}`;
        const empId = m.employeeId || '-';

        // New page if needed
        if (y + rowHeight > doc.page.height - 40) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
          y = 30;
        }

        // Alternate row bg
        if (i % 2 === 0) {
          doc.rect(startX, y, tableWidth, rowHeight).fill('#F8FAFC');
        }

        doc.fillColor('#1E293B').fontSize(7).font('Helvetica');
        x = startX;
        doc.text(empName, x + 4, y + (includeTime ? 4 : 5), { width: nameColWidth - 8 });
        x += nameColWidth;
        doc.text(empId, x + 4, y + (includeTime ? 4 : 5), { width: idColWidth - 8 });
        x += idColWidth;

        for (const date of chunk) {
          const dow = date.getDay();
          const isWorking = empWorkingDays.includes(dow);
          if (isWorking) {
            if (includeTime) {
              doc.font('Helvetica').fontSize(6);
              doc.text(empShiftStart, x + 1, y + 3, { width: dayColWidth - 2, align: 'center' });
              doc.text(empShiftEnd, x + 1, y + 13, { width: dayColWidth - 2, align: 'center' });
            } else {
              // Draw a filled green circle as check indicator
              const cx = x + dayColWidth / 2;
              const cy = y + rowHeight / 2;
              doc.save();
              doc.circle(cx, cy, 4).fill('#475569');
              doc.restore();
            }
          }
          doc.fillColor('#1E293B').font('Helvetica').fontSize(7);
          x += dayColWidth;
        }

        y += rowHeight;
      }

      // Grid lines
      doc.strokeColor('#CBD5E1').lineWidth(0.5);
      doc.rect(startX, startY, tableWidth, y - startY).stroke();

      let vx = startX + nameColWidth;
      doc.moveTo(vx, startY).lineTo(vx, y).stroke();
      vx += idColWidth;
      doc.moveTo(vx, startY).lineTo(vx, y).stroke();
      for (let d = 0; d < numCols - 1; d++) {
        vx += dayColWidth;
        doc.moveTo(vx, startY).lineTo(vx, y).stroke();
      }
      for (let hy = startY + rowHeight; hy < y; hy += rowHeight) {
        doc.moveTo(startX, hy).lineTo(startX + tableWidth, hy).stroke();
      }

      // Footer
      doc.moveDown(0.3);
      doc.fillColor('#94A3B8').fontSize(6.5).font('Helvetica');
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}  |  Org default: ${orgWorkingDays.split(',').map((d: string) => dayLabelsShort[parseInt(d)]).join(', ')} | ${orgShiftStart} - ${orgShiftEnd}`, startX);
    }

    doc.end();
  } catch (error) {
    next(error);
  }
});

export default router;
