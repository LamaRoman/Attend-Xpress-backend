import { z } from 'zod';

// HH:mm time string
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:mm format');

// Single day entry: { start: "HH:mm", end: "HH:mm" }
// start !== end is enforced — cross-midnight (e.g. 20:00→02:00) is allowed.
const dayEntrySchema = z
  .object({
    start: timeString,
    end:   timeString,
  })
  .refine((d) => d.start !== d.end, {
    message: 'start and end times cannot be the same',
    path: ['start'],
  });

// daySchedules: object keyed by day number string "0"–"6"
// At least one day required. Keys must be unique by nature of an object.
const daySchedulesSchema = z
  .record(
    z.string().regex(/^[0-6]$/, 'Day key must be a single digit 0-6'),
    dayEntrySchema,
  )
  .refine((d) => Object.keys(d).length >= 1, {
    message: 'At least one working day is required',
  });

export const createRosterScheduleSchema = z.object({
  // null / omitted = org-wide
  membershipId:  z.string().uuid().optional().nullable(),
  cycleType:     z.enum(['FIXED', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY']),
  daySchedules:  daySchedulesSchema,
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be YYYY-MM-DD'),
  // effectiveTo optional — null = open-ended
  effectiveTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  label:         z.string().max(120).optional().nullable(),
}).refine(
  (d) => !d.effectiveTo || d.effectiveTo >= d.effectiveFrom,
  { message: 'effectiveTo must be on or after effectiveFrom', path: ['effectiveTo'] },
);

export const updateRosterScheduleSchema = z.object({
  cycleType:     z.enum(['FIXED', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY']).optional(),
  daySchedules:  daySchedulesSchema.optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  label:         z.string().max(120).optional().nullable(),
}).refine(
  (d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveTo >= d.effectiveFrom,
  { message: 'effectiveTo must be on or after effectiveFrom', path: ['effectiveTo'] },
);

export const listRosterSchedulesQuerySchema = z.object({
  membershipId:   z.string().uuid().optional(),
  scope:          z.enum(['org', 'employee']).optional(),
  includeDeleted: z.coerce.boolean().default(false),
  // Phase 8b — ORG_ADMIN may voluntarily narrow to a single branch.
  // Ignored for BRANCH_ADMIN (already locked to their own branch).
  branchId:       z.string().uuid().optional(),
});

export const resolveRosterQuerySchema = z.object({
  membershipId: z.string().uuid(),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export type CreateRosterScheduleInput = z.infer<typeof createRosterScheduleSchema>;
export type UpdateRosterScheduleInput = z.infer<typeof updateRosterScheduleSchema>;
