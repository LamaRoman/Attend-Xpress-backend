/**
 * Built-in Nepal Public Holidays Data
 * Used as fallback when Calendarific API is unavailable
 * Covers BS 2081-2085 (AD 2024-2029)
 */

export interface BuiltInHoliday {
  name: string;
  nameNepali: string;
  bsYear: number;
  bsMonth: number;
  bsDay: number;
  adDate: string; // ISO date string
  type: 'PUBLIC_HOLIDAY' | 'RESTRICTED_HOLIDAY';
  isRecurring: boolean;
}

// ============================================================
// BS 2081 (April 2024 – April 2025)
// ============================================================
const BS_2081: BuiltInHoliday[] = [
  { name: 'New Year (Nawa Barsha)', nameNepali: 'नयाँ वर्ष (नवा बर्षा)', bsYear: 2081, bsMonth: 1, bsDay: 1, adDate: '2024-04-13', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'May Day (Labour Day)', nameNepali: 'मजदुर दिवस', bsYear: 2081, bsMonth: 1, bsDay: 18, adDate: '2024-05-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Buddha Jayanti', nameNepali: 'बुद्ध जयन्ती', bsYear: 2081, bsMonth: 2, bsDay: 10, adDate: '2024-05-23', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Republic Day', nameNepali: 'गणतन्त्र दिवस', bsYear: 2081, bsMonth: 2, bsDay: 15, adDate: '2024-05-28', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ropain Jatra (Paddy Day)', nameNepali: 'रोपाइँ जात्रा (धान दिवस)', bsYear: 2081, bsMonth: 3, bsDay: 15, adDate: '2024-06-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Janai Purnima / Raksha Bandhan', nameNepali: 'जनै पूर्णिमा / रक्षा बन्धन', bsYear: 2081, bsMonth: 4, bsDay: 4, adDate: '2024-08-19', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Gaijatra', nameNepali: 'गाईजात्रा', bsYear: 2081, bsMonth: 4, bsDay: 5, adDate: '2024-08-20', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Krishna Janmashtami', nameNepali: 'श्री कृष्ण जन्माष्टमी', bsYear: 2081, bsMonth: 4, bsDay: 11, adDate: '2024-08-26', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Teej', nameNepali: 'तीज', bsYear: 2081, bsMonth: 4, bsDay: 21, adDate: '2024-09-06', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Constitution Day', nameNepali: 'संविधान दिवस', bsYear: 2081, bsMonth: 5, bsDay: 3, adDate: '2024-09-19', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Indra Jatra', nameNepali: 'इन्द्र जात्रा', bsYear: 2081, bsMonth: 5, bsDay: 5, adDate: '2024-09-21', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ghatasthapana (Dashain Start)', nameNepali: 'घटस्थापना', bsYear: 2081, bsMonth: 6, bsDay: 17, adDate: '2024-10-03', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fulpati', nameNepali: 'फूलपाती', bsYear: 2081, bsMonth: 6, bsDay: 23, adDate: '2024-10-09', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Ashtami', nameNepali: 'महा अष्टमी', bsYear: 2081, bsMonth: 6, bsDay: 24, adDate: '2024-10-10', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Navami', nameNepali: 'महा नवमी', bsYear: 2081, bsMonth: 6, bsDay: 25, adDate: '2024-10-11', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Vijaya Dashami', nameNepali: 'विजया दशमी', bsYear: 2081, bsMonth: 6, bsDay: 26, adDate: '2024-10-12', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ekadashi', nameNepali: 'एकादशी', bsYear: 2081, bsMonth: 6, bsDay: 27, adDate: '2024-10-13', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Dwadashi', nameNepali: 'द्वादशी', bsYear: 2081, bsMonth: 6, bsDay: 28, adDate: '2024-10-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Kojagrat Purnima', nameNepali: 'कोजाग्रत पूर्णिमा', bsYear: 2081, bsMonth: 7, bsDay: 1, adDate: '2024-10-17', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Laxmi Puja (Tihar)', nameNepali: 'लक्ष्मी पूजा (तिहार)', bsYear: 2081, bsMonth: 7, bsDay: 15, adDate: '2024-11-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Govardhan Puja', nameNepali: 'गोवर्धन पूजा', bsYear: 2081, bsMonth: 7, bsDay: 16, adDate: '2024-11-02', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Bhai Tika', nameNepali: 'भाई टीका', bsYear: 2081, bsMonth: 7, bsDay: 17, adDate: '2024-11-03', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Chhath Parva', nameNepali: 'छठ पर्व', bsYear: 2081, bsMonth: 7, bsDay: 21, adDate: '2024-11-07', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Prithvi Jayanti', nameNepali: 'पृथ्वी जयन्ती', bsYear: 2081, bsMonth: 9, bsDay: 27, adDate: '2025-01-11', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maghe Sankranti', nameNepali: 'माघे संक्रान्ति', bsYear: 2081, bsMonth: 10, bsDay: 1, adDate: '2025-01-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Martyrs Day (Shahid Diwas)', nameNepali: 'शहीद दिवस', bsYear: 2081, bsMonth: 10, bsDay: 16, adDate: '2025-01-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Sonam Lhosar', nameNepali: 'सोनाम ल्होसार', bsYear: 2081, bsMonth: 10, bsDay: 16, adDate: '2025-01-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Shivaratri', nameNepali: 'महा शिवरात्रि', bsYear: 2081, bsMonth: 11, bsDay: 14, adDate: '2025-02-26', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Gyalpo Lhosar', nameNepali: 'ग्याल्पो ल्होसार', bsYear: 2081, bsMonth: 11, bsDay: 17, adDate: '2025-03-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fagu Purnima (Holi)', nameNepali: 'फागु पूर्णिमा (होली)', bsYear: 2081, bsMonth: 11, bsDay: 28, adDate: '2025-03-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ghode Jatra', nameNepali: 'घोडे जात्रा', bsYear: 2081, bsMonth: 12, bsDay: 16, adDate: '2025-03-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ram Navami', nameNepali: 'राम नवमी', bsYear: 2081, bsMonth: 12, bsDay: 24, adDate: '2025-04-06', type: 'PUBLIC_HOLIDAY', isRecurring: true },
];

// ============================================================
// BS 2082 (April 2025 – April 2026)
// ============================================================
const BS_2082: BuiltInHoliday[] = [
  { name: 'New Year (Nawa Barsha)', nameNepali: 'नयाँ वर्ष (नवा बर्षा)', bsYear: 2082, bsMonth: 1, bsDay: 1, adDate: '2025-04-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'May Day (Labour Day)', nameNepali: 'मजदुर दिवस', bsYear: 2082, bsMonth: 1, bsDay: 18, adDate: '2025-05-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Buddha Jayanti', nameNepali: 'बुद्ध जयन्ती', bsYear: 2082, bsMonth: 1, bsDay: 28, adDate: '2025-05-12', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Republic Day', nameNepali: 'गणतन्त्र दिवस', bsYear: 2082, bsMonth: 2, bsDay: 15, adDate: '2025-05-28', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ropain Jatra (Paddy Day)', nameNepali: 'रोपाइँ जात्रा', bsYear: 2082, bsMonth: 3, bsDay: 15, adDate: '2025-06-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Janai Purnima / Raksha Bandhan', nameNepali: 'जनै पूर्णिमा / रक्षा बन्धन', bsYear: 2082, bsMonth: 4, bsDay: 24, adDate: '2025-08-09', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Gaijatra', nameNepali: 'गाईजात्रा', bsYear: 2082, bsMonth: 4, bsDay: 25, adDate: '2025-08-10', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Krishna Janmashtami', nameNepali: 'श्री कृष्ण जन्माष्टमी', bsYear: 2082, bsMonth: 5, bsDay: 1, adDate: '2025-08-16', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Teej', nameNepali: 'तीज', bsYear: 2082, bsMonth: 5, bsDay: 10, adDate: '2025-08-26', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Constitution Day', nameNepali: 'संविधान दिवस', bsYear: 2082, bsMonth: 5, bsDay: 3, adDate: '2025-09-19', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Indra Jatra', nameNepali: 'इन्द्र जात्रा', bsYear: 2082, bsMonth: 5, bsDay: 21, adDate: '2025-09-05', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ghatasthapana (Dashain Start)', nameNepali: 'घटस्थापना', bsYear: 2082, bsMonth: 6, bsDay: 6, adDate: '2025-09-22', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fulpati', nameNepali: 'फूलपाती', bsYear: 2082, bsMonth: 6, bsDay: 12, adDate: '2025-09-28', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Ashtami', nameNepali: 'महा अष्टमी', bsYear: 2082, bsMonth: 6, bsDay: 13, adDate: '2025-09-29', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Navami', nameNepali: 'महा नवमी', bsYear: 2082, bsMonth: 6, bsDay: 14, adDate: '2025-09-30', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Vijaya Dashami', nameNepali: 'विजया दशमी', bsYear: 2082, bsMonth: 6, bsDay: 15, adDate: '2025-10-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ekadashi', nameNepali: 'एकादशी', bsYear: 2082, bsMonth: 6, bsDay: 16, adDate: '2025-10-02', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Dwadashi', nameNepali: 'द्वादशी', bsYear: 2082, bsMonth: 6, bsDay: 17, adDate: '2025-10-03', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Kojagrat Purnima', nameNepali: 'कोजाग्रत पूर्णिमा', bsYear: 2082, bsMonth: 6, bsDay: 21, adDate: '2025-10-07', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Laxmi Puja (Tihar)', nameNepali: 'लक्ष्मी पूजा (तिहार)', bsYear: 2082, bsMonth: 7, bsDay: 4, adDate: '2025-10-20', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Govardhan Puja', nameNepali: 'गोवर्धन पूजा', bsYear: 2082, bsMonth: 7, bsDay: 5, adDate: '2025-10-21', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Bhai Tika', nameNepali: 'भाई टीका', bsYear: 2082, bsMonth: 7, bsDay: 6, adDate: '2025-10-22', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Chhath Parva', nameNepali: 'छठ पर्व', bsYear: 2082, bsMonth: 7, bsDay: 10, adDate: '2025-10-26', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Prithvi Jayanti', nameNepali: 'पृथ्वी जयन्ती', bsYear: 2082, bsMonth: 9, bsDay: 27, adDate: '2026-01-11', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maghe Sankranti', nameNepali: 'माघे संक्रान्ति', bsYear: 2082, bsMonth: 10, bsDay: 1, adDate: '2026-01-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Martyrs Day (Shahid Diwas)', nameNepali: 'शहीद दिवस', bsYear: 2082, bsMonth: 10, bsDay: 16, adDate: '2026-01-30', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Shivaratri', nameNepali: 'महा शिवरात्रि', bsYear: 2082, bsMonth: 11, bsDay: 3, adDate: '2026-02-15', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fagu Purnima (Holi)', nameNepali: 'फागु पूर्णिमा (होली)', bsYear: 2082, bsMonth: 11, bsDay: 20, adDate: '2026-03-03', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ghode Jatra', nameNepali: 'घोडे जात्रा', bsYear: 2082, bsMonth: 12, bsDay: 5, adDate: '2026-03-18', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ram Navami', nameNepali: 'राम नवमी', bsYear: 2082, bsMonth: 12, bsDay: 13, adDate: '2026-03-26', type: 'PUBLIC_HOLIDAY', isRecurring: true },
];

// ============================================================
// BS 2083 (April 2026 – April 2027)
// ============================================================
const BS_2083: BuiltInHoliday[] = [
  { name: 'New Year (Nawa Barsha)', nameNepali: 'नयाँ वर्ष', bsYear: 2083, bsMonth: 1, bsDay: 1, adDate: '2026-04-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'May Day (Labour Day)', nameNepali: 'मजदुर दिवस', bsYear: 2083, bsMonth: 1, bsDay: 18, adDate: '2026-05-01', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Buddha Jayanti', nameNepali: 'बुद्ध जयन्ती', bsYear: 2083, bsMonth: 2, bsDay: 18, adDate: '2026-05-31', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Republic Day', nameNepali: 'गणतन्त्र दिवस', bsYear: 2083, bsMonth: 2, bsDay: 15, adDate: '2026-05-28', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Janai Purnima / Raksha Bandhan', nameNepali: 'जनै पूर्णिमा', bsYear: 2083, bsMonth: 4, bsDay: 13, adDate: '2026-07-28', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Krishna Janmashtami', nameNepali: 'श्री कृष्ण जन्माष्टमी', bsYear: 2083, bsMonth: 4, bsDay: 20, adDate: '2026-08-05', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Teej', nameNepali: 'तीज', bsYear: 2083, bsMonth: 4, bsDay: 30, adDate: '2026-08-15', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Constitution Day', nameNepali: 'संविधान दिवस', bsYear: 2083, bsMonth: 5, bsDay: 3, adDate: '2026-09-19', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ghatasthapana', nameNepali: 'घटस्थापना', bsYear: 2083, bsMonth: 5, bsDay: 26, adDate: '2026-10-12', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fulpati', nameNepali: 'फूलपाती', bsYear: 2083, bsMonth: 6, bsDay: 2, adDate: '2026-10-18', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Ashtami', nameNepali: 'महा अष्टमी', bsYear: 2083, bsMonth: 6, bsDay: 3, adDate: '2026-10-19', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Navami', nameNepali: 'महा नवमी', bsYear: 2083, bsMonth: 6, bsDay: 4, adDate: '2026-10-20', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Vijaya Dashami', nameNepali: 'विजया दशमी', bsYear: 2083, bsMonth: 6, bsDay: 5, adDate: '2026-10-21', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Laxmi Puja (Tihar)', nameNepali: 'लक्ष्मी पूजा (तिहार)', bsYear: 2083, bsMonth: 6, bsDay: 23, adDate: '2026-11-08', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Bhai Tika', nameNepali: 'भाई टीका', bsYear: 2083, bsMonth: 6, bsDay: 25, adDate: '2026-11-10', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Chhath Parva', nameNepali: 'छठ पर्व', bsYear: 2083, bsMonth: 6, bsDay: 29, adDate: '2026-11-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maghe Sankranti', nameNepali: 'माघे संक्रान्ति', bsYear: 2083, bsMonth: 10, bsDay: 1, adDate: '2027-01-14', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Maha Shivaratri', nameNepali: 'महा शिवरात्रि', bsYear: 2083, bsMonth: 10, bsDay: 23, adDate: '2027-02-06', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Fagu Purnima (Holi)', nameNepali: 'फागु पूर्णिमा (होली)', bsYear: 2083, bsMonth: 11, bsDay: 8, adDate: '2027-02-22', type: 'PUBLIC_HOLIDAY', isRecurring: true },
  { name: 'Ram Navami', nameNepali: 'राम नवमी', bsYear: 2083, bsMonth: 12, bsDay: 2, adDate: '2027-03-15', type: 'PUBLIC_HOLIDAY', isRecurring: true },
];

// ============================================================
// All holidays combined
// ============================================================
const ALL_HOLIDAYS: Record<number, BuiltInHoliday[]> = {
  2081: BS_2081,
  2082: BS_2082,
  2083: BS_2083,
};

/**
 * Get built-in holidays for a BS year
 */
export function getBuiltInHolidays(bsYear: number): BuiltInHoliday[] {
  return ALL_HOLIDAYS[bsYear] || [];
}

/**
 * Check if built-in data exists for a year
 */
export function hasBuiltInData(bsYear: number): boolean {
  return bsYear in ALL_HOLIDAYS;
}
