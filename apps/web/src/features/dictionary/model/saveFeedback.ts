import { ApiError } from '../../../shared/api/apiClient';

export const CHANGED = 'Mục này vừa được người khác sửa.';

export interface SaveFailure {
  /** A stale revision (409): the caller reloads and drops what was typed. */
  conflict: boolean;
  message: string | null;
  /** Messages by field, for a 400 that names its field. */
  errors: Record<string, string>;
}

/** Turns a failed save into what the forms show: the conflict notice, a message under a field, or a plain message. */
export function describeFailure(e: unknown): SaveFailure {
  if (e instanceof ApiError && e.status === 409) return { conflict: true, message: CHANGED, errors: {} };
  const field = e instanceof ApiError ? (e.details as { field?: string } | undefined)?.field : undefined;
  if (e instanceof ApiError && e.status === 400 && field) return { conflict: false, message: null, errors: { [field]: e.message } };
  return { conflict: false, message: e instanceof Error ? e.message : 'Không lưu được.', errors: {} };
}
