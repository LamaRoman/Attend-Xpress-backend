import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').trim(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  calendarMode: z.enum(['NEPALI', 'ENGLISH']).default('NEPALI'),

  // Org admin details — created alongside the org
  adminEmail: z.string().email('Invalid admin email').transform((v) => v.toLowerCase().trim()),
  adminPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  adminFirstName: z.string().min(1, 'Admin first name is required').trim(),
  adminLastName: z.string().min(1, 'Admin last name is required').trim(),
  adminPhone: z.string().optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).trim().optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  calendarMode: z.enum(['NEPALI', 'ENGLISH']).optional(),
  language: z.enum(['NEPALI', 'ENGLISH']).optional(),
  staticQREnabled: z.boolean().optional(),
  rotatingQREnabled: z.boolean().optional(),
  // Statutory deduction availability — super-admin controlled per org.
  // Field names mirror the per-employee flags on EmployeePaySettings; the
  // payroll engine ANDs the two layers.
  ssfEnabled: z.boolean().optional(),
  pfEnabled: z.boolean().optional(),
  citEnabled: z.boolean().optional(),
  tdsEnabled: z.boolean().optional(),
});

export const orgIdParamSchema = z.object({
  id: z.string().uuid('Invalid organization ID'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
