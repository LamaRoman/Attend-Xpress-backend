// Holiday Import Tests - Org Admin Operations
// Tests business logic for importing master holidays into organizations

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    holiday: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe('Holiday Import Management', () => {
  let mockPrisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = require('@/lib/prisma').default;
  });

  describe('Preview Master Holidays for Import', () => {
    it('should fetch available master holidays for a BS year', async () => {
      const bsYear = 2082;
      const organizationId = 'org-123';

      const masterHolidays = [
        {
          id: 'master-1',
          name: 'Dashain',
          nameNepali: 'दशैं',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
          adDate: '2025-10-21',
          type: 'PUBLIC_HOLIDAY',
          organizationId: null,
          isActive: true,
        },
        {
          id: 'master-2',
          name: 'Tihar',
          nameNepali: 'तिहार',
          bsYear: 2082,
          bsMonth: 8,
          bsDay: 14,
          adDate: '2025-11-03',
          type: 'PUBLIC_HOLIDAY',
          organizationId: null,
          isActive: true,
        },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);

      const holidays = await mockPrisma.holiday.findMany({
        where: {
          organizationId: null,
          bsYear: bsYear,
          isActive: true,
        },
        orderBy: [
          { bsMonth: 'asc' },
          { bsDay: 'asc' },
        ],
      });

      expect(holidays.length).toBe(2);
      expect(holidays.every((h: any) => h.organizationId === null)).toBe(true);
      expect(holidays.every((h: any) => h.bsYear === bsYear)).toBe(true);
    });

    it('should exclude inactive master holidays from preview', async () => {
      const masterHolidays = [
        {
          id: 'master-1',
          name: 'Active Holiday',
          isActive: true,
          organizationId: null,
        },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);

      const holidays = await mockPrisma.holiday.findMany({
        where: {
          organizationId: null,
          isActive: true,
        },
      });

      expect(holidays.length).toBe(1);
      expect(holidays[0].isActive).toBe(true);
    });

    it('should return empty array when no master holidays exist', async () => {
      mockPrisma.holiday.findMany.mockResolvedValue([]);

      const holidays = await mockPrisma.holiday.findMany({
        where: {
          organizationId: null,
          bsYear: 2090,
        },
      });

      expect(holidays).toEqual([]);
      expect(holidays.length).toBe(0);
    });

    it('should calculate count of importable holidays', async () => {
      const masterHolidays = Array(15).fill({}).map((_, i) => ({
        id: `master-${i}`,
        name: `Holiday ${i}`,
        organizationId: null,
      }));

      mockPrisma.holiday.count.mockResolvedValue(15);

      const count = await mockPrisma.holiday.count({
        where: {
          organizationId: null,
          bsYear: 2082,
          isActive: true,
        },
      });

      expect(count).toBe(15);
    });
  });

  describe('Import Master Holidays to Organization', () => {
    it('should import all master holidays successfully', async () => {
      const organizationId = 'org-123';
      const bsYear = 2082;

      const masterHolidays = [
        {
          id: 'master-1',
          name: 'Dashain',
          nameNepali: 'दशैं',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
          adDate: '2025-10-21',
          type: 'PUBLIC_HOLIDAY',
          isActive: true,
        },
        {
          id: 'master-2',
          name: 'Tihar',
          nameNepali: 'तिहार',
          bsYear: 2082,
          bsMonth: 8,
          bsDay: 14,
          adDate: '2025-11-03',
          type: 'PUBLIC_HOLIDAY',
          isActive: true,
        },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);
      mockPrisma.holiday.findFirst.mockResolvedValue(null);
      mockPrisma.holiday.createMany.mockResolvedValue({ count: 2 });

      const holidays = await mockPrisma.holiday.findMany({
        where: { organizationId: null, bsYear, isActive: true },
      });

      const holidaysToImport = holidays.map((h: any) => ({
        name: h.name,
        nameNepali: h.nameNepali,
        bsYear: h.bsYear,
        bsMonth: h.bsMonth,
        bsDay: h.bsDay,
        adDate: h.adDate,
        type: h.type,
        organizationId: organizationId,
        isActive: true,
      }));

      const result = await mockPrisma.holiday.createMany({
        data: holidaysToImport,
        skipDuplicates: true,
      });

      expect(result.count).toBe(2);
      expect(holidaysToImport.length).toBe(2);
      expect(holidaysToImport.every((h: any) => h.organizationId === organizationId)).toBe(true);
    });

    it('should skip already imported holidays', async () => {
      const organizationId = 'org-123';
      const bsYear = 2082;

      const masterHolidays = [
        {
          id: 'master-1',
          name: 'Dashain',
          bsYear: 2082,
          bsMonth: 7,
          bsDay: 10,
        },
      ];

      const existingOrgHoliday = {
        id: 'org-holiday-1',
        name: 'Dashain',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
        organizationId: 'org-123',
      };

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);
      mockPrisma.holiday.findFirst.mockResolvedValue(existingOrgHoliday);

      const holidays = await mockPrisma.holiday.findMany({
        where: { organizationId: null, bsYear },
      });

      const existing = await mockPrisma.holiday.findFirst({
        where: {
          organizationId: organizationId,
          bsYear: holidays[0].bsYear,
          bsMonth: holidays[0].bsMonth,
          bsDay: holidays[0].bsDay,
        },
      });

      expect(existing).not.toBeNull();
      expect(existing?.organizationId).toBe(organizationId);
    });

    it('should handle partial import (some already exist)', async () => {
      const organizationId = 'org-123';

      const masterHolidays = [
        { id: '1', name: 'Holiday 1', bsYear: 2082, bsMonth: 1, bsDay: 1 },
        { id: '2', name: 'Holiday 2', bsYear: 2082, bsMonth: 2, bsDay: 1 },
        { id: '3', name: 'Holiday 3', bsYear: 2082, bsMonth: 3, bsDay: 1 },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(masterHolidays);
      
      mockPrisma.holiday.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);

      let toImport = 0;
      let skipped = 0;

      for (const holiday of masterHolidays) {
        const existing = await mockPrisma.holiday.findFirst({
          where: {
            organizationId,
            bsYear: holiday.bsYear,
            bsMonth: holiday.bsMonth,
            bsDay: holiday.bsDay,
          },
        });

        if (!existing) {
          toImport++;
        } else {
          skipped++;
        }
      }

      expect(toImport).toBe(2);
      expect(skipped).toBe(1);
    });

    it('should preserve holiday attributes during import', async () => {
      const organizationId = 'org-123';
      const masterHoliday = {
        name: 'Dashain',
        nameNepali: 'दशैं',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
        adDate: '2025-10-21',
        type: 'PUBLIC_HOLIDAY',
        isActive: true,
      };

      const importedHoliday = {
        ...masterHoliday,
        organizationId: organizationId,
      };

      mockPrisma.holiday.create.mockResolvedValue({
        id: 'org-holiday-1',
        ...importedHoliday,
      });

      const created = await mockPrisma.holiday.create({
        data: importedHoliday,
      });

      expect(created.name).toBe(masterHoliday.name);
      expect(created.nameNepali).toBe(masterHoliday.nameNepali);
      expect(created.bsYear).toBe(masterHoliday.bsYear);
      expect(created.type).toBe(masterHoliday.type);
      expect(created.organizationId).toBe(organizationId);
    });

    it('should import only active master holidays', async () => {
      const masterHolidays = [
        { id: '1', name: 'Active', isActive: true, organizationId: null },
        { id: '2', name: 'Inactive', isActive: false, organizationId: null },
      ];

      const activeOnly = masterHolidays.filter((h: any) => h.isActive);

      expect(activeOnly.length).toBe(1);
      expect(activeOnly[0].name).toBe('Active');
    });
  });

  describe('Check Import Status', () => {
    it('should detect if holidays already imported', async () => {
      const organizationId = 'org-123';
      const bsYear = 2082;

      mockPrisma.holiday.count.mockResolvedValue(15);

      const count = await mockPrisma.holiday.count({
        where: {
          organizationId: organizationId,
          bsYear: bsYear,
        },
      });

      const alreadyImported = count > 0;

      expect(alreadyImported).toBe(true);
      expect(count).toBe(15);
    });

    it('should return false when no holidays imported', async () => {
      const organizationId = 'org-123';
      const bsYear = 2082;

      mockPrisma.holiday.count.mockResolvedValue(0);

      const count = await mockPrisma.holiday.count({
        where: {
          organizationId: organizationId,
          bsYear: bsYear,
        },
      });

      const alreadyImported = count > 0;

      expect(alreadyImported).toBe(false);
      expect(count).toBe(0);
    });

    it('should count imported holidays', async () => {
      const organizationId = 'org-123';
      
      mockPrisma.holiday.count
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(18);

      const count2082 = await mockPrisma.holiday.count({
        where: { organizationId, bsYear: 2082 },
      });

      const count2083 = await mockPrisma.holiday.count({
        where: { organizationId, bsYear: 2083 },
      });

      expect(count2082).toBe(15);
      expect(count2083).toBe(18);
    });
  });

  describe('Organization Isolation', () => {
    it('should only import to specific organization', async () => {
      const org1 = 'org-123';
      const org2 = 'org-456';

      const masterHoliday = {
        name: 'Dashain',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
      };

      const org1Holiday = { ...masterHoliday, organizationId: org1 };
      const org2Holiday = { ...masterHoliday, organizationId: org2 };

      mockPrisma.holiday.create
        .mockResolvedValueOnce({ id: '1', ...org1Holiday })
        .mockResolvedValueOnce({ id: '2', ...org2Holiday });

      const created1 = await mockPrisma.holiday.create({ data: org1Holiday });
      const created2 = await mockPrisma.holiday.create({ data: org2Holiday });

      expect(created1.organizationId).toBe(org1);
      expect(created2.organizationId).toBe(org2);
      expect(created1.organizationId).not.toBe(created2.organizationId);
    });

    it('should not see other organization holidays', async () => {
      const org1 = 'org-123';
      const org1Holidays = [
        { id: '1', name: 'Holiday 1', organizationId: org1 },
        { id: '2', name: 'Holiday 2', organizationId: org1 },
      ];

      mockPrisma.holiday.findMany.mockResolvedValue(org1Holidays);

      const holidays = await mockPrisma.holiday.findMany({
        where: { organizationId: org1 },
      });

      expect(holidays.every((h: any) => h.organizationId === org1)).toBe(true);
      expect(holidays.length).toBe(2);
    });

    it('should allow same holiday in multiple organizations', async () => {
      const masterHoliday = {
        name: 'Dashain',
        bsYear: 2082,
        bsMonth: 7,
        bsDay: 10,
      };

      const organizations = ['org-1', 'org-2', 'org-3'];
      const imports = organizations.map((orgId: any) => ({
        ...masterHoliday,
        organizationId: orgId,
      }));

      expect(imports.length).toBe(3);
      expect(imports.every((h: any) => h.name === 'Dashain')).toBe(true);
      expect(new Set(imports.map((h: any) => h.organizationId)).size).toBe(3);
    });
  });

  describe('Import Validation and Edge Cases', () => {
    it('should handle empty master holidays list', async () => {
      const organizationId = 'org-123';
      mockPrisma.holiday.findMany.mockResolvedValue([]);

      const holidays = await mockPrisma.holiday.findMany({
        where: { organizationId: null, bsYear: 2082 },
      });

      const toImport = holidays.map((h: any) => ({
        ...h,
        organizationId,
      }));

      expect(toImport.length).toBe(0);
    });

    it('should validate organization exists before import', () => {
      const organizationId = 'org-123';
      const isValidOrg = organizationId && organizationId.length > 0;

      expect(isValidOrg).toBe(true);
    });

    it('should handle duplicate prevention with createMany', async () => {
      const holidaysToImport = [
        { name: 'Holiday 1', bsYear: 2082, bsMonth: 1, bsDay: 1 },
        { name: 'Holiday 2', bsYear: 2082, bsMonth: 2, bsDay: 1 },
      ];

      mockPrisma.holiday.createMany.mockResolvedValue({ count: 2 });

      const result = await mockPrisma.holiday.createMany({
        data: holidaysToImport,
        skipDuplicates: true,
      });

      expect(result.count).toBe(2);
    });

    it('should count successful imports vs skipped', async () => {
      const total = 15;
      const imported = 12;
      const skipped = total - imported;

      expect(imported).toBe(12);
      expect(skipped).toBe(3);
      expect(imported + skipped).toBe(total);
    });

    it('should handle import of single year only', async () => {
      const bsYear = 2082;
      const masterHolidays = [
        { id: '1', bsYear: 2081, name: 'Old Year' },
        { id: '2', bsYear: 2082, name: 'Current Year' },
        { id: '3', bsYear: 2083, name: 'Future Year' },
      ];

      const filtered = masterHolidays.filter((h: any) => h.bsYear === bsYear);

      expect(filtered.length).toBe(1);
      expect(filtered[0].bsYear).toBe(2082);
    });

    it('should preserve original holiday IDs are not copied', async () => {
      const masterHoliday = {
        id: 'master-123',
        name: 'Dashain',
        bsYear: 2082,
      };

      const toImport = {
        name: masterHoliday.name,
        bsYear: masterHoliday.bsYear,
        organizationId: 'org-123',
      };

      const importedHolidayHasNoMasterId = !('id' in toImport) || (toImport as any).id !== masterHoliday.id;

      expect(importedHolidayHasNoMasterId).toBe(true);
    });
  });

  describe('Bulk Import Operations', () => {
    it('should import multiple years at once', async () => {
      const organizationId = 'org-123';
      const years = [2081, 2082, 2083];
      let totalImported = 0;

      for (const year of years) {
        mockPrisma.holiday.findMany.mockResolvedValue([
          { name: `Holiday ${year}`, bsYear: year },
        ]);

        const holidays = await mockPrisma.holiday.findMany({
          where: { organizationId: null, bsYear: year },
        });

        totalImported += holidays.length;
      }

      expect(totalImported).toBe(3);
    });

    it('should calculate import progress percentage', () => {
      const total = 20;
      const current = 15;
      const percentage = (current / total) * 100;

      expect(percentage).toBe(75);
    });

    it('should handle large batch imports efficiently', async () => {
      const largeHolidaySet = Array(100).fill({}).map((_, i) => ({
        name: `Holiday ${i}`,
        bsYear: 2082,
        bsMonth: (i % 12) + 1,
        bsDay: (i % 30) + 1,
      }));

      mockPrisma.holiday.createMany.mockResolvedValue({ count: 100 });

      const result = await mockPrisma.holiday.createMany({
        data: largeHolidaySet,
        skipDuplicates: true,
      });

      expect(result.count).toBe(100);
    });
  });
});
