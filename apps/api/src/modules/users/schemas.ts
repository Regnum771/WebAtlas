import { z } from 'zod';

// The editor role is retired (P1): only these two are accepted.
const Role = z.enum(['admin', 'viewer']);

export const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
  role: Role.default('viewer'),
});
export const UpdateUserBody = z.object({
  full_name: z.string().nullable().optional(),
  role: Role.optional(),
  is_active: z.boolean().optional(),
  /** Storage quota in bytes (workspace files and features). */
  quotaBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export const UserIdParams = z.object({ id: z.string().uuid() });
