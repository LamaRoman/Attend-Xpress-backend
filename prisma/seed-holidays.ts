import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Nepal Government Holidays for BS 2081 and 2082
// Each entry: [AD date, BS date string, English name, Nepali name, type]
const HOLIDAYS_2081: [string, string, string, string, string][] = [
  // BS 2081 (approx AD 2024-04 to 2025-04)
  ['2024-04-14', '2081-01-01', 'Nepali New Year', 'नयाँ वर्ष', 'PUBLIC_HOLIDAY'],
  ['2024-05-01', '2081-01-18', 'May Day', 'मजदुर दिवस', 'PUBLIC_HOLIDAY'],
  ['2024-05-23', '2081-02-10', 'Buddha Jayanti', 'बुद्ध जयन्ती', 'PUBLIC_HOLIDAY'],
  ['2024-05-28', '2081-02-15', 'Republic Day', 'गणतन्त्र दिवस', 'PUBLIC_HOLIDAY'],
  ['2024-06-17', '2081-03-03', 'Eid ul-Fitr', 'इद उल-फित्र', 'PUBLIC_HOLIDAY'],
  ['2024-08-19', '2081-05-03', 'Janai Purnima', 'जनै पूर्णिमा', 'PUBLIC_HOLIDAY'],
  ['2024-08-26', '2081-05-10', 'Krishna Janmashtami', 'कृष्ण जन्माष्टमी', 'PUBLIC_HOLIDAY'],
  ['2024-09-06', '2081-05-21', 'Teej', 'तीज', 'PUBLIC_HOLIDAY'],
  ['2024-09-19', '2081-06-03', 'Constitution Day', 'संविधान दिवस', 'PUBLIC_HOLIDAY'],
  ['2024-09-20', '2081-06-04', 'Indra Jatra', 'इन्द्र जात्रा', 'PUBLIC_HOLIDAY'],
  ['2024-10-03', '2081-06-17', 'Ghatasthapana', 'घटस्थापना', 'PUBLIC_HOLIDAY'],
  ['2024-10-12', '2081-06-26', 'Dashain (Vijaya Dashami)', 'विजया दशमी', 'PUBLIC_HOLIDAY'],
  ['2024-10-13', '2081-06-27', 'Dashain (Ekadashi)', 'एकादशी', 'PUBLIC_HOLIDAY'],
  ['2024-10-14', '2081-06-28', 'Dashain (Dwadashi)', 'द्वादशी', 'PUBLIC_HOLIDAY'],
  ['2024-10-15', '2081-06-29', 'Dashain (Trayodashi)', 'त्रयोदशी', 'PUBLIC_HOLIDAY'],
  ['2024-11-01', '2081-07-16', 'Tihar (Laxmi Puja)', 'लक्ष्मी पूजा', 'PUBLIC_HOLIDAY'],
  ['2024-11-02', '2081-07-17', 'Tihar (Gobardhan Puja)', 'गोवर्धन पूजा', 'PUBLIC_HOLIDAY'],
  ['2024-11-03', '2081-07-18', 'Tihar (Bhai Tika)', 'भाई टिका', 'PUBLIC_HOLIDAY'],
  ['2024-11-07', '2081-07-22', 'Chhath Parva', 'छठ पर्व', 'PUBLIC_HOLIDAY'],
  ['2024-11-15', '2081-07-30', 'Guru Nanak Jayanti', 'गुरु नानक जयन्ती', 'PUBLIC_HOLIDAY'],
  ['2024-12-25', '2081-09-10', 'Christmas', 'क्रिसमस', 'PUBLIC_HOLIDAY'],
  ['2025-01-11', '2081-09-27', 'Prithvi Jayanti', 'पृथ्वी जयन्ती', 'PUBLIC_HOLIDAY'],
  ['2025-01-14', '2081-09-30', 'Maghe Sankranti', 'माघे संक्रान्ति', 'PUBLIC_HOLIDAY'],
  ['2025-01-29', '2081-10-15', 'Sonam Lhosar', 'सोनम ल्होसार', 'PUBLIC_HOLIDAY'],
  ['2025-01-30', '2081-10-16', 'Martyrs Day', 'शहीद दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-02-12', '2081-10-29', 'National Democracy Day', 'प्रजातन्त्र दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-02-26', '2081-11-14', 'Maha Shivaratri', 'महा शिवरात्रि', 'PUBLIC_HOLIDAY'],
  ['2025-03-08', '2081-11-24', 'Intl Women\'s Day', 'अन्तर्राष्ट्रिय महिला दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-03-14', '2081-11-30', 'Fagu Purnima (Holi)', 'फागु पूर्णिमा', 'PUBLIC_HOLIDAY'],
  ['2025-03-30', '2081-12-16', 'Ghode Jatra', 'घोडे जात्रा', 'PUBLIC_HOLIDAY'],
  ['2025-04-06', '2081-12-23', 'Ram Navami', 'राम नवमी', 'PUBLIC_HOLIDAY'],
];

const HOLIDAYS_2082: [string, string, string, string, string][] = [
  // BS 2082 (approx AD 2025-04 to 2026-04)
  ['2025-04-14', '2082-01-01', 'Nepali New Year', 'नयाँ वर्ष', 'PUBLIC_HOLIDAY'],
  ['2025-05-01', '2082-01-18', 'May Day', 'मजदुर दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-05-12', '2082-01-29', 'Buddha Jayanti', 'बुद्ध जयन्ती', 'PUBLIC_HOLIDAY'],
  ['2025-05-28', '2082-02-14', 'Republic Day', 'गणतन्त्र दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-08-09', '2082-04-24', 'Janai Purnima', 'जनै पूर्णिमा', 'PUBLIC_HOLIDAY'],
  ['2025-08-16', '2082-05-01', 'Krishna Janmashtami', 'कृष्ण जन्माष्टमी', 'PUBLIC_HOLIDAY'],
  ['2025-08-26', '2082-05-10', 'Teej', 'तीज', 'PUBLIC_HOLIDAY'],
  ['2025-09-19', '2082-06-02', 'Constitution Day', 'संविधान दिवस', 'PUBLIC_HOLIDAY'],
  ['2025-09-22', '2082-06-05', 'Ghatasthapana', 'घटस्थापना', 'PUBLIC_HOLIDAY'],
  ['2025-10-01', '2082-06-14', 'Dashain (Vijaya Dashami)', 'विजया दशमी', 'PUBLIC_HOLIDAY'],
  ['2025-10-02', '2082-06-15', 'Dashain (Ekadashi)', 'एकादशी', 'PUBLIC_HOLIDAY'],
  ['2025-10-03', '2082-06-16', 'Dashain (Dwadashi)', 'द्वादशी', 'PUBLIC_HOLIDAY'],
  ['2025-10-21', '2082-07-04', 'Tihar (Laxmi Puja)', 'लक्ष्मी पूजा', 'PUBLIC_HOLIDAY'],
  ['2025-10-22', '2082-07-05', 'Tihar (Gobardhan Puja)', 'गोवर्धन पूजा', 'PUBLIC_HOLIDAY'],
  ['2025-10-23', '2082-07-06', 'Tihar (Bhai Tika)', 'भाई टिका', 'PUBLIC_HOLIDAY'],
  ['2025-10-26', '2082-07-09', 'Chhath Parva', 'छठ पर्व', 'PUBLIC_HOLIDAY'],
  ['2025-12-25', '2082-09-09', 'Christmas', 'क्रिसमस', 'PUBLIC_HOLIDAY'],
  ['2026-01-14', '2082-09-30', 'Maghe Sankranti', 'माघे संक्रान्ति', 'PUBLIC_HOLIDAY'],
  ['2026-01-30', '2082-10-16', 'Martyrs Day', 'शहीद दिवस', 'PUBLIC_HOLIDAY'],
  ['2026-02-12', '2082-10-29', 'National Democracy Day', 'प्रजातन्त्र दिवस', 'PUBLIC_HOLIDAY'],
  ['2026-02-15', '2082-11-03', 'Maha Shivaratri', 'महा शिवरात्रि', 'PUBLIC_HOLIDAY'],
  ['2026-03-03', '2082-11-19', 'Fagu Purnima (Holi)', 'फागु पूर्णिमा', 'PUBLIC_HOLIDAY'],
  ['2026-03-08', '2082-11-24', 'Intl Women\'s Day', 'अन्तर्राष्ट्रिय महिला दिवस', 'PUBLIC_HOLIDAY'],
  ['2026-03-19', '2082-12-05', 'Ghode Jatra', 'घोडे जात्रा', 'PUBLIC_HOLIDAY'],
  ['2026-03-26', '2082-12-12', 'Ram Navami', 'राम नवमी', 'PUBLIC_HOLIDAY'],
];

export async function seedHolidays() {
  console.log('Seeding holidays...');

  const allHolidays = [...HOLIDAYS_2081, ...HOLIDAYS_2082];

  for (const [adDate, bsDate, name, nameNp, type] of allHolidays) {
    const [bsYearStr, bsMonthStr] = bsDate.split('-');
    const bsYear = parseInt(bsYearStr);
    const bsMonth = parseInt(bsMonthStr);

    await prisma.holiday.upsert({
      where: { date: new Date(adDate) },
      update: { name, nameNp, bsDate, bsYear, bsMonth, type: type as 'PUBLIC_HOLIDAY' },
      create: {
        date: new Date(adDate),
        bsDate,
        name,
        nameNp,
        type: type as 'PUBLIC_HOLIDAY',
        bsYear,
        bsMonth,
        isActive: true,
      },
    });
  }

  console.log(`Seeded ${allHolidays.length} holidays for BS 2081-2082`);
}

// Also seed default system config
export async function seedSystemConfig() {
  console.log('Seeding system config...');

  const configs = [
    { key: 'calendar_display', value: 'nepali', description: 'Calendar display mode: nepali (unicode) or english (romanized)' },
    { key: 'scan_cooldown_seconds', value: '300', description: 'Cooldown between scans in seconds' },
    { key: 'standard_work_hours', value: '8', description: 'Standard work hours per day' },
    { key: 'weekend_days', value: '6', description: 'Weekend day numbers (0=Sun, 6=Sat). Comma-separated for multiple.' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }

  console.log(`Seeded ${configs.length} system config entries`);
}

// Run if called directly
async function main() {
  await seedHolidays();
  await seedSystemConfig();
}

main()
  .catch((e) => {
    console.error('Seeding holidays failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
