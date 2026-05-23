// ============================================================
// Bikram Sambat (BS) ↔ Gregorian (AD) Date Converter
// Complete library for Nepal calendar operations
// ============================================================

// BS month names
export const BS_MONTHS_EN = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan',
  'Bhadra', 'Ashwin', 'Kartik', 'Mangsir',
  'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export const BS_MONTHS_NP = [
  'बैशाख', 'जेठ', 'असार', 'श्रावण',
  'भाद्र', 'आश्विन', 'कार्तिक', 'मंसिर',
  'पौष', 'माघ', 'फाल्गुन', 'चैत्र',
];

// Nepali digits
const NEPALI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export interface BSDate {
  year: number;
  month: number;
  day: number;
}

// ============================================================
// BS Calendar Data (2070–2090)
// Each row: [days in month 1, month 2, ... month 12]
// ============================================================
const BS_CALENDAR_DATA: Record<number, number[]> = {
  2070: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2073: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2074: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2077: [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2078: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2081: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2085: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2087: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2088: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2089: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2090: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
};

// Reference date: BS 2070/01/01 = AD 2013/04/14
const BS_REFERENCE = { year: 2070, month: 1, day: 1 };
const AD_REFERENCE = new Date(2013, 3, 14); // April 14, 2013

// ============================================================
// Core Conversion Functions
// ============================================================

/**
 * Convert AD (Gregorian) date to BS date
 */
export function adToBS(date: Date): BSDate {
  // Calculate total days from AD reference to the given date
  const diffTime = date.getTime() - AD_REFERENCE.getTime();
  let totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (totalDays < 0) {
    throw new Error('Date is before the supported BS range (before 2070/01/01)');
  }

  let bsYear = BS_REFERENCE.year;
  let bsMonth = BS_REFERENCE.month;
  let bsDay = BS_REFERENCE.day;

  while (totalDays > 0) {
    const daysInCurrentMonth = getDaysInBSMonth(bsYear, bsMonth);
    const daysRemainingInMonth = daysInCurrentMonth - bsDay;

    if (totalDays <= daysRemainingInMonth) {
      bsDay += totalDays;
      totalDays = 0;
    } else {
      totalDays -= (daysRemainingInMonth + 1);
      bsMonth++;
      bsDay = 1;

      if (bsMonth > 12) {
        bsMonth = 1;
        bsYear++;
      }
    }

    if (!BS_CALENDAR_DATA[bsYear]) {
      throw new Error(`BS year ${bsYear} is outside the supported range (2070-2090)`);
    }
  }

  return { year: bsYear, month: bsMonth, day: bsDay };
}

/**
 * Convert BS date to AD (Gregorian) date
 * Supports both object and individual argument forms
 */
export function bsToAD(dateOrYear: BSDate | number, month?: number, day?: number): Date {
  let bsYear: number, bsMonth: number, bsDay: number;

  if (typeof dateOrYear === 'object') {
    bsYear = dateOrYear.year;
    bsMonth = dateOrYear.month;
    bsDay = dateOrYear.day;
  } else {
    bsYear = dateOrYear;
    bsMonth = month!;
    bsDay = day!;
  }

  if (!BS_CALENDAR_DATA[bsYear]) {
    throw new Error(`BS year ${bsYear} is outside the supported range (2070-2090)`);
  }

  if (bsMonth < 1 || bsMonth > 12) {
    throw new Error(`Invalid BS month: ${bsMonth}`);
  }

  const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
  if (bsDay < 1 || bsDay > daysInMonth) {
    throw new Error(`Invalid BS day: ${bsDay} for month ${bsMonth} of year ${bsYear} (max: ${daysInMonth})`);
  }

  // Count total days from BS reference to the given BS date
  let totalDays = 0;

  // Add full years
  for (let y = BS_REFERENCE.year; y < bsYear; y++) {
    if (!BS_CALENDAR_DATA[y]) break;
    for (let m = 1; m <= 12; m++) {
      totalDays += BS_CALENDAR_DATA[y][m - 1];
    }
  }

  // Add full months of the target year
  for (let m = 1; m < bsMonth; m++) {
    totalDays += BS_CALENDAR_DATA[bsYear][m - 1];
  }

  // Add remaining days (minus 1 because reference starts at day 1)
  totalDays += bsDay - 1;

  // Add total days to AD reference date
  const result = new Date(AD_REFERENCE);
  result.setDate(result.getDate() + totalDays);

  return result;
}

// ============================================================
// Month & Day Utilities
// ============================================================

/**
 * Get number of days in a BS month
 */
export function getDaysInBSMonth(year: number, month: number): number {
  const yearData = BS_CALENDAR_DATA[year];
  if (!yearData) {
    throw new Error(`BS year ${year} is outside the supported range (2070-2090)`);
  }
  if (month < 1 || month > 12) {
    throw new Error(`Invalid BS month: ${month}`);
  }
  return yearData[month - 1];
}

/**
 * Get total days in a BS year
 */
export function getDaysInBSYear(year: number): number {
  const yearData = BS_CALENDAR_DATA[year];
  if (!yearData) {
    throw new Error(`BS year ${year} is outside the supported range`);
  }
  return yearData.reduce((sum, d) => sum + d, 0);
}

/**
 * Parse org workingDays string (e.g. "0,1,2,3,4,5") into a Set of day numbers.
 * 0=Sunday, 1=Monday, ..., 6=Saturday — matches JavaScript's Date.getDay().
 * Default: "0,1,2,3,4,5" = Sunday-Friday (Nepal standard 6-day week).
 */
function parseWorkingDays(orgWorkingDays?: string): Set<number> {
  const raw = orgWorkingDays ?? '0,1,2,3,4,5';
  return new Set(
    raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
  );
}

/**
 * Get working days in a BS month (excluding weekly holidays).
 * Uses the org's workingDays setting to determine which days are off.
 */
export function getWorkingDaysInBSMonth(
  bsYear: number,
  bsMonth: number,
  orgWorkingDays?: string
): number {
  const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
  const firstDayAD = bsToAD({ year: bsYear, month: bsMonth, day: 1 });
  const workingDaySet = parseWorkingDays(orgWorkingDays);

  let workingDays = 0;
  for (let d = 0; d < daysInMonth; d++) {
    const currentDay = new Date(firstDayAD);
    currentDay.setDate(currentDay.getDate() + d);
    if (workingDaySet.has(currentDay.getDay())) {
      workingDays++;
    }
  }

  return workingDays;
}

/**
 * Get effective working days (excluding weekly holidays AND public holidays).
 * Uses the org's workingDays setting to determine which days are weekly holidays.
 */
export function getEffectiveWorkingDays(
  bsYear: number,
  bsMonth: number,
  holidayDates: Date[],
  orgWorkingDays?: string
): number {
  const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
  const firstDayAD = bsToAD({ year: bsYear, month: bsMonth, day: 1 });
  const workingDaySet = parseWorkingDays(orgWorkingDays);

  // Normalize holiday dates to date strings for comparison
  const holidaySet = new Set(
    holidayDates.map((d) => d.toISOString().split('T')[0])
  );

  let workingDays = 0;
  for (let d = 0; d < daysInMonth; d++) {
    const currentDay = new Date(firstDayAD);
    currentDay.setDate(currentDay.getDate() + d);

    const isWorkingDay = workingDaySet.has(currentDay.getDay());
    const isHoliday = holidaySet.has(currentDay.toISOString().split('T')[0]);

    if (isWorkingDay && !isHoliday) {
      workingDays++;
    }
  }

  return workingDays;
}

/**
 * Get the AD date range for a BS month
 * Returns { start: Date, end: Date } in AD
 */
export function getBSMonthADRange(
  bsYear: number,
  bsMonth: number
): { start: Date; end: Date } {
  const daysInMonth = getDaysInBSMonth(bsYear, bsMonth);
  const start = bsToAD({ year: bsYear, month: bsMonth, day: 1 });
  const end = bsToAD({ year: bsYear, month: bsMonth, day: daysInMonth });

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

// ============================================================
// Current Date Helpers
// ============================================================

/**
 * Get current date in BS
 */
export function getCurrentBSDate(): BSDate {
  return adToBS(new Date());
}

/**
 * Format a date with both AD and BS representations
 */
export function formatNepaliDate(date: Date) {
  const bs = adToBS(date);

  return {
    ad: {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      formatted: date.toISOString().split('T')[0],
      dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
    },
    bs: {
      year: bs.year,
      month: bs.month,
      day: bs.day,
      monthNameEn: BS_MONTHS_EN[bs.month - 1],
      monthNameNp: BS_MONTHS_NP[bs.month - 1],
      formatted: `${bs.year}/${String(bs.month).padStart(2, '0')}/${String(bs.day).padStart(2, '0')}`,
      formattedNp: `${toNepaliDigits(bs.year)} ${BS_MONTHS_NP[bs.month - 1]} ${toNepaliDigits(bs.day)}`,
    },
  };
}

// ============================================================
// Year Options (for dropdowns in frontend)
// ============================================================

/**
 * Get an array of BS year options around the current year
 */
export function getBSYearOptions(range: number = 5): number[] {
  const current = getCurrentBSDate();
  const years: number[] = [];

  for (let y = current.year - range; y <= current.year + range; y++) {
    if (BS_CALENDAR_DATA[y]) {
      years.push(y);
    }
  }

  return years;
}

// ============================================================
// Nepali Digit Conversion
// ============================================================

/**
 * Convert number to Nepali digits
 */
export function toNepaliDigits(num: number): string {
  return String(num)
    .split('')
    .map((ch) => (ch >= '0' && ch <= '9' ? NEPALI_DIGITS[parseInt(ch)] : ch))
    .join('');
}

/**
 * Convert Nepali digits string to number
 */
export function fromNepaliDigits(nepaliStr: string): number {
  const englishStr = nepaliStr
    .split('')
    .map((ch) => {
      const idx = NEPALI_DIGITS.indexOf(ch);
      return idx >= 0 ? String(idx) : ch;
    })
    .join('');

  return parseInt(englishStr, 10);
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Check if a BS date is valid
 */
export function isValidBSDate(year: number, month: number, day: number): boolean {
  if (!BS_CALENDAR_DATA[year]) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > BS_CALENDAR_DATA[year][month - 1]) return false;
  return true;
}

/**
 * Get supported BS year range
 */
export function getSupportedBSYearRange(): { min: number; max: number } {
  const years = Object.keys(BS_CALENDAR_DATA).map(Number);
  return { min: Math.min(...years), max: Math.max(...years) };
}
