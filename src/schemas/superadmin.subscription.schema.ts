// src/schemas/superadmin.subscription.schema.ts
// ============================================================
// Zod schemas for super admin subscription routes.
// Matches the validate() middleware pattern in the codebase.
// ============================================================

import { z } from 'zod';
import { SubscriptionStatus, TierName } from '@prisma/client';

// ── Params ────────────────────────────────────────────────────

export const orgIdParamSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
});

// ── Query ─────────────────────────────────────────────────────

export const listOrgsQuerySchema = z.object({
  page:   z.coerce.number().int().positive().optional(),
  limit:  z.coerce.number().int().min(1).max(100).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  tier:   z.nativeEnum(TierName).optional(),
  search: z.string().max(100).optional(),
});

// ── Bodies ────────────────────────────────────────────────────

export const assignTierSchema = z.object({
  tier: z.nativeEnum(TierName, {
    errorMap: () => ({ message: `Tier must be one of: ${Object.values(TierName).join(', ')}` }),
  }),
  note: z.string().max(500).optional(),
  forceTrial: z.boolean().optional(),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
});

export const overridePricingSchema = z.object({
  customPricePerEmployee: z.number().min(0, 'Price cannot be negative').nullable(),
  customMaxEmployees:     z.number().int().positive().nullable().optional(),
  isPriceLockedForever:   z.boolean().optional(),
  customPriceExpiresAt:   z.string().datetime().nullable().optional(),
  note:                   z.string().max(500).optional(),
});

export const waiveSetupFeeSchema = z.object({
  reason: z.string().min(5, 'Please provide a reason (min 5 characters)').max(500),
});

export const suspendSchema = z.object({
  reason: z.string().min(5, 'Please provide a reason (min 5 characters)').max(500),
});

export const reactivateSchema = z.object({
  note: z.string().max(500).optional(),
  forceTrial: z.boolean().optional(),
});

export const addNoteSchema = z.object({
  note: z.string().min(1, 'Note cannot be empty').max(2000),
});
