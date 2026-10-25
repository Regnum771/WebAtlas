import { ApiError } from '../../../shared/api/apiClient';

export const CHANGED = 'Mục này vừa được người khác sửa.';

export interface SaveFailure {
  /** A stale revision (409): the caller reloads and drops what was typed. */
  conflict: boolean;
  message: string | null;
  /** Messages by field, for a 400 that names a field the form shows. */
  errors: Record<string, string>;
}

/**
 * Turns a failed save into what the forms show: the conflict notice, a message under a field, or a
 * plain message. `shown` lists the fields the form renders an error under; a 400 naming any other
 * field (expectedRevision, fields, a key the form never sends) is shown as the form's message, so
 * it is never invisible.
 */
export function describeFailure(e: unknown, shown: readonly string[]): SaveFailure {
  if (e instanceof ApiError && e.status === 409) return { conflict: true, message: CHANGED, errors: {} };
  const field = e instanceof ApiError ? (e.details as { field?: string } | undefined)?.field : undefined;
  if (e instanceof ApiError && e.status === 400 && field && shown.includes(field)) {
    return { conflict: false, message: null, errors: { [field]: e.message } };
  }
  return { conflict: false, message: e instanceof Error ? e.message : 'Không lưu được.', errors: {} };
}
