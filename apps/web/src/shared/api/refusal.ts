import { PERMISSION_LABELS } from '@webatlas/shared';
import { ApiError } from './apiClient';

/** A permission refusal from the API, ready to show: the server's message and an optional second line. */
export interface Refusal {
  message: string;
  /** Names the missing review right when the operation's own permission passed. */
  detail: string | null;
}

/**
 * Maps a 403 OUT_OF_JURISDICTION / NO_PERMISSION to the server's message (spec copy, shown
 * verbatim). When the refused permission was submission.review, a second line names it, since
 * the message alone reads as if the operation itself were out of scope. Null for anything else.
 */
export function refusalOf(e: unknown): Refusal | null {
  if (!(e instanceof ApiError) || e.status !== 403) return null;
  if (e.code !== 'OUT_OF_JURISDICTION' && e.code !== 'NO_PERMISSION') return null;
  const permission = (e.details as { permission?: unknown } | null | undefined)?.permission;
  return {
    message: e.message,
    detail: permission === 'submission.review' ? `Thiếu quyền ${PERMISSION_LABELS['submission.review']}.` : null,
  };
}
