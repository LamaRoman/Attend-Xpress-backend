import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email format').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
