import { z } from 'zod';

// System config
export const updateConfigSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

export const configKeyParamSchema = z.object({
  key: z.string().min(1).max(100),
});

// Nepali date
export const convertDateQuerySchema = z.object({
  ad: z.string().optional(),
  bsYear: z.coerce.number().int().optional(),
  bsMonth: z.coerce.number().int().optional(),
  bsDay: z.coerce.number().int().optional(),
});

export const monthInfoQuerySchema = z.object({
  bsYear: z.coerce.number().int().min(2070).max(2090),
  bsMonth: z.coerce.number().int().min(1).max(12),
});


