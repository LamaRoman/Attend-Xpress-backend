import NodeCache from 'node-cache';
import prisma from '../lib/prisma';
import { bsToAD, adToBS } from '../lib/nepali-date';
import { config } from '../config';
import { createLogger } from '../logger';
import { getBuiltInHolidays, hasBuiltInData } from '../lib/nepal-holidays';
import { NotFoundError } from '../lib/errors';
import { JWTPayload } from '../lib/jwt';
import { CreateHolidayInput } from '../schemas/holiday.schema';

const log = createLogger('holiday-service');
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache

interface CalendarificHoliday {
  name: string;
  description: string;
  date: { iso: string; datetime: { year: number; month: number; day: number } };
  type: string[];
}

export class HolidayService {
  /**
   * List holidays — org-scoped (includes national + org-specific)
   * WORKING_DAY_OVERRIDE records are excluded from the main list
   * and returned separately so the frontend can show them with a special badge.
   */
  async listHolidays(currentUser: JWTPayload, filters: { bsYear?: number; bsMonth?: number }) {
    const where: Record<string, unknown> = {};

    if (filters.bsYear) where.bsYear = filters.bsYear;
    if (filters.bsMonth) where.bsMonth = filters.bsMonth;

    // Show national holidays (orgId = null) + org-specific holidays
    if (currentUser.role !== 'SUPER_ADMIN' && currentUser.organizationId) {
      where.OR = [
        { organizationId: null },
        { organizationId: currentUser.organizationId },
      ];
    }

    where.isActive = true;

    const all = await prisma.holiday.findMany({
      where,
      orderBy: [{ bsYear: 'desc' }, { bsMonth: 'asc' }, { bsDay: 'asc' }],
    });

    // Separate overrides so frontend can render them differently
    const holidays = all.filter((h) => h.type !== 'WORKING_DAY_OVERRIDE');
    const overrides = all.filter((h) => h.type === 'WORKING_DAY_OVERRIDE');

    // Mark holidays that have been overridden for this org
    const overrideDateSet = new Set(
      overrides.map((o) => o.date.toISOString().split('T')[0])
    );

    return holidays.map((h) => ({
      ...h,
      isOverridden: overrideDateSet.has(h.date.toISOString().split('T')[0]),
      overrideId: overrides.find(
        (o) => o.date.toISOString().split('T')[0] === h.date.toISOString().split('T')[0]
      )?.id ?? null,
    }));
  }

  /**
   * Create a holiday manually
   */
  async createHoliday(input: CreateHolidayInput, currentUser: JWTPayload) {
    const organizationId = currentUser.role === 'SUPER_ADMIN' ? null : currentUser.organizationId;

    return prisma.holiday.create({
      data: {
        name: input.name,
        nameNepali: input.nameNepali || null,
        bsYear: input.bsYear,
        bsMonth: input.bsMonth,
        bsDay: input.bsDay,
        date: input.date,
        type: input.type,
        isRecurring: input.isRecurring,
        isActive: true,
        organizationId,
        description: input.description,
      },
    });
  }

  /**
   * Toggle holiday active status.
   *
   * Cross-org isolation:
   *   - Org-scoped holidays (organizationId != null) can only be modified by
   *     a caller in the same org.
   *   - National holidays (organizationId == null) can only be modified by
   *     SUPER_ADMIN. Without this gate, any ORG_ADMIN could disable Dashain
   *     (or any national holiday) platform-wide via GET /holidays/master →
   *     PUT /holidays/:id, since the master endpoint exposes every national
   *     UUID to authenticated admins.
   *
   * Cross-org misses throw NotFoundError (not Forbidden) to avoid
   * enumeration, matching the pattern used elsewhere in the service layer.
   */
  async updateHoliday(holidayId: string, isActive: boolean, currentUser: JWTPayload) {
    const holiday = await prisma.holiday.findUnique({
      where: { id: holidayId },
      select: { organizationId: true },
    });
    if (!holiday) throw new NotFoundError('Holiday not found');

    if (holiday.organizationId === null) {
      // National holiday — SUPER_ADMIN only
      if (currentUser.role !== 'SUPER_ADMIN') {
        throw new NotFoundError('Holiday not found');
      }
    } else if (
      currentUser.role !== 'SUPER_ADMIN' &&
      holiday.organizationId !== currentUser.organizationId
    ) {
      // Org-scoped holiday belonging to a different org
      throw new NotFoundError('Holiday not found');
    }

    return prisma.holiday.update({
      where: { id: holidayId },
      data: { isActive },
    });
  }

  /**
   * Delete holiday.
   *
   * Same cross-org isolation rules as updateHoliday: org-scoped holidays
   * require same-org caller, national holidays (organizationId == null)
   * require SUPER_ADMIN.
   */
  async deleteHoliday(holidayId: string, currentUser: JWTPayload) {
    const holiday = await prisma.holiday.findUnique({
      where: { id: holidayId },
      select: { organizationId: true },
    });
    if (!holiday) throw new NotFoundError('Holiday not found');

    if (holiday.organizationId === null) {
      if (currentUser.role !== 'SUPER_ADMIN') {
        throw new NotFoundError('Holiday not found');
      }
    } else if (
      currentUser.role !== 'SUPER_ADMIN' &&
      holiday.organizationId !== currentUser.organizationId
    ) {
      throw new NotFoundError('Holiday not found');
    }

    await prisma.holiday.delete({ where: { id: holidayId } });
    return { message: 'Holiday deleted' };
  }

  /**
   * Sync holidays from Calendarific API for a BS year
   */
  async syncHolidaysForBSYear(bsYear: number): Promise<{ synced: number; skipped: number; source?: string }> {
    let synced = 0;
    let skipped = 0;
    let source = 'api';
    try {
      const startOfYear = bsToAD({ year: bsYear, month: 1, day: 1 });
      const endOfYear = bsToAD({ year: bsYear, month: 12, day: 30 });
      const adYears = new Set([startOfYear.getFullYear(), endOfYear.getFullYear()]);
      for (const adYear of adYears) {
        const holidays = await this.fetchHolidaysFromAPI(adYear);
        for (const holiday of holidays) {
          const adDate = new Date(holiday.date.iso);
          if (adDate < startOfYear || adDate > endOfYear) continue;
          const bs = adToBS(adDate);
          const existing = await prisma.holiday.findFirst({
            where: { bsYear: bs.year, bsMonth: bs.month, bsDay: bs.day, organizationId: null },
          });
          if (existing) { skipped++; continue; }
          await prisma.holiday.create({
            data: {
              name: holiday.name, nameNepali: this.getNepalName(holiday.name),
              bsYear: bs.year, bsMonth: bs.month, bsDay: bs.day,
              date: adDate, type: 'PUBLIC_HOLIDAY', isActive: true,
              isRecurring: this.isRecurringHoliday(holiday.name),
            },
          });
          synced++;
        }
      }
    } catch (apiErr: any) {
      log.warn({ bsYear, error: apiErr.message }, 'API sync failed, trying built-in data');
      synced = 0; skipped = 0; source = 'built-in';
      if (!hasBuiltInData(bsYear)) {
        throw new Error('No holiday data for BS ' + bsYear + '. Configure CALENDARIFIC_API_KEY or use a supported year.');
      }
      const builtIn = getBuiltInHolidays(bsYear);
      for (const h of builtIn) {
        const existing = await prisma.holiday.findFirst({
          where: { bsYear: h.bsYear, bsMonth: h.bsMonth, bsDay: h.bsDay, organizationId: null },
        });
        if (existing) { skipped++; continue; }
        await prisma.holiday.create({
          data: {
            name: h.name, nameNepali: h.nameNepali,
            bsYear: h.bsYear, bsMonth: h.bsMonth, bsDay: h.bsDay,
            date: new Date(h.adDate), type: h.type, isActive: true,
            isRecurring: h.isRecurring,
          },
        });
        synced++;
      }
    }
    log.info({ bsYear, synced, skipped, source }, 'Holiday sync complete');
    return { synced, skipped, source };
  }

  /**
   * Get holiday dates for a BS month (used by payroll).
   *
   * Returns AD dates that count as non-working days for the given org.
   *
   * Logic:
   * 1. Fetch PUBLIC_HOLIDAY and ORGANIZATION_HOLIDAY records for the month
   *    (national holidays have organizationId = null; org holidays are org-scoped)
   * 2. Fetch WORKING_DAY_OVERRIDE records for this org
   *    (org admin has declared they will work on a normally-off holiday)
   * 3. Subtract override dates from holiday dates
   *
   * RESTRICTED_HOLIDAY is intentionally excluded — it is optional/employee-choice
   * and does not affect payroll working day count.
   */
  async getHolidayDatesForMonth(
    bsYear: number,
    bsMonth: number,
    organizationId?: string
  ): Promise<Date[]> {
    const baseWhere: Record<string, unknown> = {
      bsYear,
      bsMonth,
      isActive: true,
      type: { in: ['PUBLIC_HOLIDAY', 'ORGANIZATION_HOLIDAY'] },
    };

    if (organizationId) {
      baseWhere.OR = [
        { organizationId: null },
        { organizationId },
      ];
    }

    const holidays = await prisma.holiday.findMany({ where: baseWhere });

    // Fetch working day overrides for this specific org only
    const overrides = organizationId
      ? await prisma.holiday.findMany({
          where: {
            bsYear,
            bsMonth,
            isActive: true,
            type: 'WORKING_DAY_OVERRIDE',
            organizationId,
          },
        })
      : [];

    // Remove dates the org has declared as working days
    const overrideDates = new Set(
      overrides.map((o) => o.date.toISOString().split('T')[0])
    );

    return holidays
      .filter((h) => !overrideDates.has(h.date.toISOString().split('T')[0]))
      .map((h) => h.date);
  }

  // ======== Private helpers ========

  private async fetchHolidaysFromAPI(adYear: number): Promise<CalendarificHoliday[]> {
    const apiKey = config.CALENDARIFIC_API_KEY;
    if (!apiKey || apiKey.startsWith('get_from')) {
      throw new Error('Calendarific API key not configured');
    }

    const cacheKey = `holidays_${adYear}`;
    const cached = cache.get<CalendarificHoliday[]>(cacheKey);
    if (cached) return cached;

    const url = `https://calendarific.com/api/v2/holidays?api_key=${apiKey}&country=NP&year=${adYear}`;

    const response = await fetch(url);
    const data = await response.json() as any;

    if (data.meta.code !== 200) {
      throw new Error(`Calendarific API error: ${data.meta.error_detail || 'Unknown'}`);
    }

    // Accept all holiday types Calendarific returns for Nepal
    // (previously filtered to National/Public only, which missed many valid holidays)
    const holidays: CalendarificHoliday[] = data.response.holidays;

    cache.set(cacheKey, holidays);
    return holidays;
  }

  private getNepalName(englishName: string): string | null {
    const nameMap: Record<string, string> = {
      'Nepali New Year': 'नयाँ वर्ष',
      'Republic Day': 'गणतन्त्र दिवस',
      'Constitution Day': 'संविधान दिवस',
      'Democracy Day': 'लोकतन्त्र दिवस',
      'Dashain': 'दशैं',
      'Tihar': 'तिहार',
      'Buddha Jayanti': 'बुद्ध जयन्ती',
      'Holi': 'होली',
      'Teej': 'तीज',
      'Janai Purnima': 'जनै पूर्णिमा',
      'Krishna Janmashtami': 'कृष्ण जन्माष्टमी',
    };

    for (const [eng, nep] of Object.entries(nameMap)) {
      if (englishName.toLowerCase().includes(eng.toLowerCase())) return nep;
    }
    return null;
  }

  private isRecurringHoliday(name: string): boolean {
    const recurring = ['New Year', 'Republic Day', 'Constitution Day', 'Democracy Day', 'International Women', 'Labour Day'];
    return recurring.some((h) => name.toLowerCase().includes(h.toLowerCase()));
  }
}

export const holidayService = new HolidayService();