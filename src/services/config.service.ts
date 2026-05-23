import prisma from '../lib/prisma';
import {
  bsToAD, formatNepaliDate, getCurrentBSDate,
  getDaysInBSMonth, getWorkingDaysInBSMonth, getEffectiveWorkingDays,
  getBSYearOptions, BS_MONTHS_EN, BS_MONTHS_NP,
} from '../lib/nepali-date';
import { JWTPayload } from '../lib/jwt';
import { holidayService } from './holiday.service';

export class ConfigService {
  /**
   * Get all config for an organization
   */
  async getConfigs(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    const configs = await prisma.systemConfig.findMany({
      where: { organizationId },
      orderBy: { key: 'asc' },
    });

    const configMap: Record<string, string> = {};
    for (const c of configs) {
      configMap[c.key] = c.value;
    }

    return { configs, configMap };
  }

  /**
   * Upsert a config value
   */
  async setConfig(key: string, value: string, currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    return prisma.systemConfig.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { value },
      create: { organizationId, key, value },
    });
  }
}

export class NepaliDateService {
  /**
   * Get today's date in BS format
   */
  async getToday(currentUser: JWTPayload) {
    const today = formatNepaliDate(new Date());

    // Get org's calendar preference
    let displayMode = 'NEPALI';
    if (currentUser.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.organizationId },
        select: { calendarMode: true },
      });
      displayMode = org?.calendarMode || 'NEPALI';
    }

    return { ...today, displayMode };
  }

  /**
   * Convert between AD and BS dates
   */
  convert(params: { ad?: string; bsYear?: number; bsMonth?: number; bsDay?: number }) {
    if (params.ad) {
      const adDate = new Date(params.ad);
      return formatNepaliDate(adDate);
    }

    if (params.bsYear && params.bsMonth && params.bsDay) {
      const adDate = bsToAD({ year: params.bsYear, month: params.bsMonth, day: params.bsDay });
      return formatNepaliDate(adDate);
    }

    return null;
  }

  /**
   * Get detailed info about a BS month
   */
  async getMonthInfo(bsYear: number, bsMonth: number, currentUser: JWTPayload) {
    // Fetch org's working days setting
    let orgWorkingDays: string | undefined;
    if (currentUser.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.organizationId },
        select: { workingDays: true },
      });
      orgWorkingDays = org?.workingDays;
    }

    const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
    const workingDays = getWorkingDaysInBSMonth(bsYear, bsMonth, orgWorkingDays);

    const holidayDates = await holidayService.getHolidayDatesForMonth(
      bsYear, bsMonth, currentUser.organizationId || undefined
    );
    const effectiveWorkingDays = getEffectiveWorkingDays(bsYear, bsMonth, holidayDates, orgWorkingDays);

    const holidays = await prisma.holiday.findMany({
      where: {
        bsYear,
        bsMonth,
        isActive: true,
        OR: currentUser.organizationId
          ? [{ organizationId: null }, { organizationId: currentUser.organizationId }]
          : undefined,
      },
      orderBy: { date: 'asc' },
    });

    const firstDay = bsToAD({ year: bsYear, month: bsMonth, day: 1 });
    const lastDay = bsToAD({ year: bsYear, month: bsMonth, day: daysInMonth });

    return {
      bsYear,
      bsMonth,
      monthNameEn: BS_MONTHS_EN[bsMonth - 1],
      monthNameNp: BS_MONTHS_NP[bsMonth - 1],
      daysInMonth,
      workingDaysExclSaturday: workingDays,
      holidaysCount: holidays.length,
      effectiveWorkingDays,
      holidays,
      adRange: {
        start: firstDay.toISOString().split('T')[0],
        end: lastDay.toISOString().split('T')[0],
      },
    };
  }

  /**
   * Get available BS years for dropdowns
   */
  async getYears(currentUser: JWTPayload) {
    const years = getBSYearOptions(5);
    const current = getCurrentBSDate();

    let displayMode = 'NEPALI';
    if (currentUser.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.organizationId },
        select: { calendarMode: true },
      });
      displayMode = org?.calendarMode || 'NEPALI';
    }

    return {
      years,
      currentBSYear: current.year,
      currentBSMonth: current.month,
      currentBSDay: current.day,
      months: BS_MONTHS_EN.map((en, i) => ({
        month: i + 1,
        nameEn: en,
        nameNp: BS_MONTHS_NP[i],
      })),
      displayMode,
    };
  }
}

export const configService = new ConfigService();
export const nepaliDateService = new NepaliDateService();
