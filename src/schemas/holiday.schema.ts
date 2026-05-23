import { z } from 'zod';

export const createHolidaySchema = z.object({
  name: z.string().min(1, 'Holiday name is required').trim(),
  nameNepali: z.string().optional(),
  bsYear: z.coerce.number().int().min(2070).max(2090),
  bsMonth: z.coerce.number().int().min(1).max(12),
  bsDay: z.coerce.number().int().min(1).max(32),
  date: z.string().transform((v) => new Date(v)), // AD date as ISO string
  type: z.enum([
    'PUBLIC_HOLIDAY',
    'RESTRICTED_HOLIDAY',
    'ORGANIZATION_HOLIDAY',
    'WORKING_DAY_OVERRIDE',
  ]).default('PUBLIC_HOLIDAY'),
  isRecurring: z.boolean().default(false),
  description: z.string().optional(),
});

export const updateHolidaySchema = z.object({
  isActive: z.boolean(),
});

export const syncHolidaysSchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090),
});

export const holidayListQuerySchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090).optional(),
  bsMonth: z.coerce.number().int().min(1).max(12).optional(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type SyncHolidaysInput = z.infer<typeof syncHolidaysSchema>;