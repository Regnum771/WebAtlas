import type { ZodTypeAny, z } from 'zod';
import { ValidationError } from '../errors';

export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.flatten());
  }
  return result.data;
}
