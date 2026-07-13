import { z } from 'zod';
export const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
  role: z.enum(['admin', 'editor', 'viewer']).default('viewer'),
});
export const UpdateUserBody = z.object({
  full_name: z.string().nullable().optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  is_active: z.boolean().optional(),
});
export const UserIdParams = z.object({ id: z.string().uuid() });
