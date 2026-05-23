// src/jobs/midnight-autoclose.job.ts
// ============================================================
// Auto-closes stale CHECKED_IN attendance records.
//
// Three triggers (belt-and-suspenders):
//   1. Midnight cron  — runs daily at 00:00 NPT
//   2. Startup catch-up — runs once when server boots
//   3. API endpoint    — manual trigger by admin
//
// Only closes records where the employee's shift end has passed
// on the check-in day. Today's active check-ins are never touched.
// ============================================================
import cron from 'node-cron';
import prisma from '../lib/prisma';
import { parseDaySchedules } from '../services/roster.service';
import { createLogger } from '../logger';
import { withJobAlerts } from './withJobAlerts';
import { alerter } from '../lib/alerter';

const log = createLogger('midnight-autoclose-job');

/**
 * Core auto-close logic.
 * @param trigger - Label for logging (e.g. 'midnight-cron', 'startup', 'api')
 */
export async function runAutoClose(trigger: string = 'midnight-cron'): Promise<{ closed: number; skipped: number; failed: number }> {
  log.info({ trigger }, 'Auto-close job started');

  const now = new Date();

  const openRecords = await prisma.attendanceRecord.findMany({
    where: { status: 'CHECKED_IN' },
    select: {
      id: true,
      membershipId: true,
      checkInTime: true,
      membership: {
        select: {
          organizationId: true,
          shiftStartTime: true,
          shiftEndTime: true,
          organization: {
            select: {
              workStartTime: true,
              workEndTime: true,
              autoCloseGraceMinutes: true,
            },
          },
        },
      },
    },
  });

  if (openRecords.length === 0) {
    log.info({ trigger }, 'No open attendance records to auto-close');
    return { closed: 0, skipped: 0, failed: 0 };
  }

  log.info({ trigger, count: openRecords.length }, 'Found open records to evaluate');

  let closed = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of openRecords) {
    try {
      const org = record.membership.organization;
      const autoCloseGrace = org.autoCloseGraceMinutes ?? 240;

      // Fetch roster schedules for this employee (1 query per open record — acceptable,
      // open records are rare compared to total attendance volume)
      const rosterSchedules = record.membership.organizationId
        ? await prisma.rosterSchedule.findMany({
            where: {
              organizationId: record.membership.organizationId,
              deletedAt: null,
              OR: [{ membershipId: record.membershipId }, { membershipId: null }],
            },
            select: {
              membershipId: true,
              daySchedules: true,
              effectiveFrom: true,
              effectiveTo: true,
            },
          })
        : [];

      // Resolve shift times using 4-level priority for the check-in date
      const recDate = record.checkInTime;
      const dayOfWeek = recDate.getDay();
      const empSched = rosterSchedules.find(
        (s) => s.membershipId === record.membershipId &&
               recDate >= s.effectiveFrom &&
               (s.effectiveTo === null || recDate <= s.effectiveTo),
      );
      const orgSched = !empSched ? rosterSchedules.find(
        (s) => s.membershipId === null &&
               recDate >= s.effectiveFrom &&
               (s.effectiveTo === null || recDate <= s.effectiveTo),
      ) : undefined;

      // Parse daySchedules from whichever roster level matched
      const rosterDayMap = empSched
        ? parseDaySchedules(empSched.daySchedules)
        : orgSched
          ? parseDaySchedules(orgSched.daySchedules)
          : null;

      const dayEntry = rosterDayMap?.[dayOfWeek] ?? null;

      const startTimeStr =
        dayEntry?.start ??
        record.membership.shiftStartTime ??
        org.workStartTime ??
        '10:00';
      const endTimeStr =
        dayEntry?.end ??
        record.membership.shiftEndTime ??
        org.workEndTime ??
        '18:00';

      const [startHour, startMinute] = startTimeStr.split(':').map(Number);
      const [endHour, endMinute] = endTimeStr.split(':').map(Number);

      // Compute shift end on the check-in calendar day
      const shiftEnd = new Date(record.checkInTime);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // Cross-midnight shift: end time is earlier than start time in total minutes
      // so shift end belongs to the next calendar day
      if (endHour * 60 + endMinute < startHour * 60 + startMinute) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
      }

      // Grace window: don't close until autoCloseGrace minutes past shift end
      // This ensures we don't close a cross-midnight shift at midnight while
      // the employee is still working
      const graceEnd = new Date(shiftEnd.getTime() + autoCloseGrace * 60 * 1000);

      // Only close if grace window has passed
      if (graceEnd >= now) {
        skipped++;
        log.info({ recordId: record.id, trigger, shiftEnd, graceEnd }, 'Skipped — within grace window');
        continue;
      }

      const checkOutTime = shiftEnd;
      const duration = Math.floor(
        (checkOutTime.getTime() - record.checkInTime.getTime()) / 60000
      );

      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkOutTime,
          checkOutMethod: 'MANUAL',
          duration,
          status: 'AUTO_CLOSED',
          notes:
            `Auto-closed by system (${trigger}) — employee did not clock out. ` +
            `Check-out capped at shift end (${checkOutTime.toTimeString().slice(0, 5)}).`,
        },
      });

      closed++;
      log.info(
        {
          recordId: record.id,
          membershipId: record.membershipId,
          cappedCheckOut: checkOutTime.toISOString(),
          durationMinutes: duration,
          trigger,
        },
        'Record auto-closed'
      );
    } catch (err) {
      failed++;
      log.error({ err, recordId: record.id, trigger }, 'Failed to auto-close record');
    }
  }

  log.info({ closed, skipped, failed, trigger }, 'Auto-close job completed');
  return { closed, skipped, failed };
}

// Legacy alias — keeps existing imports working
export async function runMidnightAutoCloseJob(): Promise<void> {
  await runAutoClose('midnight-cron');
}

export function startMidnightAutoCloseJob(): void {
  // ── Startup catch-up ──────────────────────────────────────
  // Close any stale records immediately on boot.
  // Handles missed midnights from restarts, cold starts, local dev, etc.
  setTimeout(async () => {
    try {
      const result = await runAutoClose('startup');
      if (result.closed > 0) {
        log.info({ closed: result.closed }, 'Startup catch-up closed stale records');
      }
    } catch (err) {
      log.error({ err }, 'Startup catch-up failed');
      // Fire-and-forget alert; alerter never throws.
      alerter.send({
        source: 'midnight-autoclose-startup',
        title: 'Auto-close startup catch-up failed',
        severity: 'critical',
        error: err,
      });
    }
  }, 5000); // 5s delay — let DB connections stabilize

  // ── Midnight cron ─────────────────────────────────────────
  // '0 0 * * *' = midnight in server local time.
  // Requires TZ=Asia/Kathmandu in Railway environment variables.
  cron.schedule(
    '0 0 * * *',
    withJobAlerts('midnight-autoclose-job', runMidnightAutoCloseJob, { severity: 'critical' })
  );

  log.info(
    'Auto-close job initialized — startup catch-up in 5s, cron at 00:00 NPT'
  );
}