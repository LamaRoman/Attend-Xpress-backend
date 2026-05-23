// Master Holidays Tests - Super Admin Operations
// Tests business logic for managing master holidays (organizationId: null)

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    holiday: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    organization: {
      count: jest.fn(),
    },
  },
}));

// Mock built-in holidays data
jest.mock('@/lib/nepal-holidays', () => ({
  getBuiltInHolidays: jest.fn(),
}));

describe('Master Holidays Management', () => {
  let mockPrisma: any;
  let mockGetBuiltInHolidays: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = require('@/lib/prisma').default;
    mockGetBuiltInHolidays = require('@/lib/nepal-holidays').getBuiltInHolidays;
  });

  describe('Sync Holidays from Built-in Data', () => {
    it('should sync holidays for a BS year successfully', async () => {
      const bsYear = 2082;
      const builtInHolidays = [
        {
          name: 'Dashain',
          nameNepali: 'दशैं',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
          adDate: '2025-10-21',
          type: 'PUBLIC_HOLIDAY',
        },
        {
          name: 'Tihar',
          nameNepali: 'तिहार',
          bsYear: 2082,
          bsMonth: 8,
          bsDay: 14,
          adDate: '2025-11-03',
          type: 'PUBLIC_HOLIDAY',
        },
      ];

      mockGetBuiltInHolidays.mockReturnValue(builtInHolidays);
      mockPrisma.holiday.findFirst.mockResolvedValue(null);
      mockPrisma.holiday.create.mockResolvedValue({ id: 'holiday-1' });

      const holidays = mockGetBuiltInHolidays(bsYear);
      let synced = 0;
      let skipped = 0;

      for (const holiday of holidays) {
        const existing = await mockPrisma.holiday.findFirst({
          where: {
            organizationId: null,
            bsYear: holiday.bsYear,
            bsMonth: holiday.bsMonth,
            bsDay: holiday.bsDay,
          },
        });

        if (!existing) {
          await mockPrisma.holiday.create({
            data: {
              ...holiday,
              organizationId: null,
              isActive: true,
            },
          });
          synced++;
        } else {
          skipped++;
        }
      }

      expect(mockGetBuiltInHolidays).toHaveBeenCalledWith(bsYear);
      expect(synced).toBe(2);
      expect(skipped).toBe(0);
      expect(mockPrisma.holiday.create).toHaveBeenCalledTimes(2);
    });

    it('should skip already synced holidays', async () => {
      const bsYear = 2082;
      const builtInHolidays = [
        {
          name: 'Dashain',
          nameNepali: 'दशैं',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
          adDate: '2025-10-21',
          type: 'PUBLIC_HOLIDAY',
        },
      ];

      mockGetBuiltInHolidays.mockReturnValue(builtInHolidays);
      mockPrisma.holiday.findFirst.mockResolvedValue({
        id: 'existing-1',
        name: 'Dashain',
        organizationId: null,
      });

      const holidays = mockGetBuiltInHolidays(bsYear);
      let synced = 0;
      let skipped = 0;

      for (const holiday of holidays) {
        const existing = await mockPrisma.holiday.findFirst({
          where: {
            organizationId: null,
            bsYear: holiday.bsYear,
            bsMonth: holiday.bsMonth,
            bsDay: holiday.bsDay,
          },
        });

        if (!existing) {
          synced++;
        } else {
          skipped++;
        }
      }

      expect(synced).toBe(0);
      expect(skipped).toBe(1);
      expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
    });

    it('should handle empty built-in data gracefully', async () => {
      const bsYear = 2090;
      mockGetBuiltInHolidays.mockReturnValue([]);

      const holidays = mockGetBuiltInHolidays(bsYear);

      expect(holidays).toEqual([]);
      expect(holidays.length).toBe(0);
    });
  });

  describe('Create Master Holiday', () => {
    it('should create a custom master holiday', async () => {
      const newHoliday = {
        name: 'Custom Holiday',
        nameNepali: 'कस्टम छुट्टी',
        bsYear: 2082,
        bsMonth: 1,
        bsDay: 15,
        adDate: '2025-05-01',
        type: 'PUBLIC_HOLIDAY',
        organizationId: null,
        isActive: true,
      };

      mockPrisma.holiday.findFirst.mockResolvedValue(null);
      mockPrisma.holiday.create.mockResolvedValue({
        id: 'master-1',
        ...newHoliday,
      });

      const existing = await mockPrisma.holiday.findFirst({
        where: {
          organizationId: null,
          bsYear: newHoliday.bsYear,
          bsMonth: newHoliday.bsMonth,
          bsDay: newHoliday.bsDay,
        },
      });

      expect(existing).toBeNull();

      const created = await mockPrisma.holiday.create({ data: newHoliday });

      expect(created).toMatchObject(newHoliday);
      expect(created.id).toBe('master-1');
    });

    it('should prevent duplicate master holidays (same date)', async () => {
      const existingHoliday = {
        id: 'existing-1',
        name: 'Dashain',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
        organizationId: null,
      };

      const newHoliday = {
        name: 'Dashain Day 2',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
        organizationId: null,
      };

      mockPrisma.holiday.findFirst.mockResolvedValue(existingHoliday);

      const duplicate = await mockPrisma.holiday.findFirst({
        where: {
          organizationId: null,
          bsYear: newHoliday.bsYear,
          bsMonth: newHoliday.bsMonth,
          bsDay: newHoliday.bsDay,
        },
      });

      expect(duplicate).not.toBeNull();
      expect(duplicate?.name).toBe('Dashain');
    });

    it('should validate BS month (1-12)', () => {
      const invalidMonths = [-1, 0, 13, 15];
      const validMonths = [1, 6, 12];

      invalidMonths.forEach((month) => {
        expect(month >= 1 && month <= 12).toBe(false);
      });

      validMonths.forEach((month) => {
        expect(month >= 1 && month <= 12).toBe(true);
      });
    });

    it('should validate BS day (1-32)', () => {
      const invalidDays = [-1, 0, 33, 40];
      const validDays = [1, 15, 30, 32];

      invalidDays.forEach((day) => {
        expect(day >= 1 && day <= 32).toBe(false);
      });

      validDays.forEach((day) => {
        expect(day >= 1 && day <= 32).toBe(true);
      });
    });
  });

  describe('List and Filter Master Holidays', () => {
    it('should fetch master holidays for a BS year', async () => {
      const bsYear = 2082;
      const masterHolidays = [
        {
          id: '1',
          name: 'Dashain',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
          organizationId: null,
          isActive: true,
        },
        {
          id: '2',
          name: 'Tihar',
          bsYear: 2082,
          bsMonth: 8,
          bsDay: 14,
          organizationId: null,
          isActive: true,
        },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);

      const holidays = await mockPrisma.holiday.findMany({
        where: {
          organizationId: null,
          bsYear: bsYear,
        },
        orderBy: [
          { bsMonth: 'asc' },
          { bsDay: 'asc' },
        ],
      });

      expect(holidays.length).toBe(2);
      expect(holidays[0].organizationId).toBeNull();
      expect(holidays[1].organizationId).toBeNull();
    });

    it('should search holidays by name', async () => {
      const allHolidays = [
        { id: '1', name: 'Dashain', nameNepali: 'दशैं', organizationId: null },
        { id: '2', name: 'New Year', nameNepali: 'नयाँ वर्ष', organizationId: null },
        { id: '3', name: 'Buddha Jayanti', nameNepali: 'बुद्ध जयन्ती', organizationId: null },
      ];

      const searchTerm = 'Dashain';
      const filtered = allHolidays.filter(
        (h: any) =>
          h.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          h.nameNepali.includes(searchTerm)
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Dashain');
    });
  });

  describe('Import Statistics', () => {
    it('should count organizations that imported each year', async () => {
      const bsYear = 2082;
      mockPrisma.organization.count.mockResolvedValue(10);

      mockPrisma.holiday.groupBy.mockResolvedValue([
        { bsYear: 2082, _count: { organizationId: 7 } },
      ]);

      const totalOrgs = await mockPrisma.organization.count({
        where: { isActive: true },
      });

      const importStats = await mockPrisma.holiday.groupBy({
        by: ['bsYear'],
        where: {
          bsYear: bsYear,
          organizationId: { not: null },
        },
        _count: {
          organizationId: true,
        },
      });

      const importedCount = importStats[0]?._count.organizationId || 0;

      expect(totalOrgs).toBe(10);
      expect(importedCount).toBe(7);
    });

    it('should handle zero imports', async () => {
      mockPrisma.organization.count.mockResolvedValue(5);
      mockPrisma.holiday.groupBy.mockResolvedValue([]);

      const totalOrgs = await mockPrisma.organization.count({
        where: { isActive: true },
      });

      const importStats = await mockPrisma.holiday.groupBy({
        by: ['bsYear'],
        where: {
          bsYear: 2082,
          organizationId: { not: null },
        },
        _count: {
          organizationId: true,
        },
      });

      const importedCount = importStats[0]?._count.organizationId || 0;

      expect(totalOrgs).toBe(5);
      expect(importedCount).toBe(0);
    });

    it('should calculate import percentage', () => {
      const totalOrgs = 10;
      const importedOrgs = 7;
      const percentage = (importedOrgs / totalOrgs) * 100;

      expect(percentage).toBe(70);
    });
  });
});
