import { z } from 'zod';

export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  recordedAt: z.string().datetime().optional(), // ISO string; defaults to now() if omitted
});

export const routeQuerySchema = z.object({
  membershipId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export const liveQuerySchema = z.object({
  organizationId: z.string().uuid().optional(), // admin's org injected server-side; param for super admin only
});

export type LocationPingInput = z.infer<typeof locationPingSchema>;
