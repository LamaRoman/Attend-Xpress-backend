import { z } from 'zod';

const timeField = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(
    z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format').optional()
  )
  .nullable()
  .optional();

const dobField = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD format').optional()
  )
  .nullable()
  .optional();

// Comma-separated day numbers 0-6 (Sun=0 .. Sat=6), e.g. "0,1,2,3,4,5"
const workingDaysField = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(
    z.string().regex(/^[0-6](,[0-6])*$/, 'Must be comma-separated day numbers 0-6').optional()
  )
  .nullable()
  .optional();

export const createUserSchema = z.object({
  email: z.string().email('Invalid email format').transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character')
    .optional(),
  firstName: z.string().min(1, 'First name is required').trim(),
  lastName: z.string().min(1, 'Last name is required').trim(),
  phone: z.string().optional(),
  panNumber: z.string().optional(),
  dateOfBirth: dobField,
  shiftStartTime: timeField,
  shiftEndTime: timeField,
  workingDays: workingDaysField,
  role: z.enum(['ORG_ADMIN', 'BRANCH_ADMIN', 'ORG_ACCOUNTANT', 'EMPLOYEE'], { errorMap: () => ({ message: 'Role must be ORG_ADMIN, BRANCH_ADMIN, ORG_ACCOUNTANT, or EMPLOYEE' }) }).default('EMPLOYEE'),
  branchId: z.string().uuid('Invalid branch ID').optional(),
});

export const addExistingUserSchema = z.object({
  platformId: z.string().min(1, 'Platform ID is required').regex(/^\d{8}$/, 'Platform ID must be an 8-digit number').trim(),
  role: z.enum(['ORG_ADMIN', 'BRANCH_ADMIN', 'ORG_ACCOUNTANT', 'EMPLOYEE'], {
    errorMap: () => ({ message: 'Role must be ORG_ADMIN, BRANCH_ADMIN, ORG_ACCOUNTANT, or EMPLOYEE' }),
  }).default('EMPLOYEE'),
  panNumber: z.string().optional(),
  shiftStartTime: timeField,
  shiftEndTime: timeField,
  workingDays: workingDaysField,
  branchId: z.string().uuid('Invalid branch ID').optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email('Invalid email format').transform((v) => v.toLowerCase().trim()).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character')
    .optional(),
  firstName: z.string().min(1).trim().optional(),
  lastName: z.string().min(1).trim().optional(),
  phone: z.string().optional(),
  panNumber: z.string().optional(),
  dateOfBirth: dobField,
  shiftStartTime: timeField,
  shiftEndTime: timeField,
  workingDays: workingDaysField,
  role: z.enum(['ORG_ADMIN', 'BRANCH_ADMIN', 'ORG_ACCOUNTANT', 'EMPLOYEE']).optional(),
  isActive: z.boolean().optional(),
  isFieldStaff: z.boolean().optional(),
  branchId: z.string().uuid('Invalid branch ID').nullable().optional(),
  currentPassword: z.string().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type AddExistingUserInput = z.infer<typeof addExistingUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
