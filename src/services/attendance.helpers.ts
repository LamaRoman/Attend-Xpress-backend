/**
 * Internal helpers for AttendanceService.
 *
 * Extracted from attendance.service.ts as a first organizational step
 * toward splitting the larger service file. Pure module-scope utilities
 * with no class state — safe to import anywhere within the service layer
 * (currently only used by attendance.service.ts).
 */
import { ValidationError } from '../lib/errors';

export const SCAN_COOLDOWN_MINUTES = 2;
export const MAX_EDIT_WINDOW_DAYS = 90;

/**
 * How many minutes past shift end before an open record is treated as
 * a forgotten clock-out and auto-closed.
 *
 * 4 hours (240 min) covers:
 *  - Reasonable overtime stays (employee genuinely stayed late)
 *  - Night-shift employees whose shift-end crosses midnight
 * Beyond this window the system assumes the employee forgot to clock out.
 */
export const AUTO_CLOSE_GRACE_MINUTES = 4 * 60; // 240 minutes

/** Nepal timezone for consistent server-side formatting */
const NPT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kathmandu',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

export function formatTimeNPT(date: Date): string {
  return date.toLocaleTimeString('en-US', NPT);
}

/**
 * Get today's start and end in Nepal time (Asia/Kathmandu).
 * Requires TZ=Asia/Kathmandu set on the server (Railway env variable).
 */
export function getTodayRangeNPT(): { todayStart: Date; todayEnd: Date } {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  return { todayStart, todayEnd };
}

export function validateTimestamp(raw: string, fieldName: string): Date {
  const d = new Date(raw);
  if (isNaN(d.getTime()))
    throw new ValidationError(`${fieldName} is not a valid date`, 'INVALID_DATE');
  const now = new Date();
  if (d > now)
    throw new ValidationError(`${fieldName} cannot be in the future`, 'FUTURE_DATE');
  const cutoff = new Date(now.getTime() - MAX_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (d < cutoff)
    throw new ValidationError(
      `${fieldName} cannot be more than ${MAX_EDIT_WINDOW_DAYS} days in the past`,
      'DATE_TOO_OLD'
    );
  return d;
}
