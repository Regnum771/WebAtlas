import type { SaveWarning } from '../api/features.api';
import { showToast } from '../../../shared/ui/toast.store';

/** Save warnings (e.g. OUTSIDE_MANAGING_UNIT) as warning toasts, which stay until closed. */
export function showWarnings(warnings: SaveWarning[] | undefined): void {
  for (const w of warnings ?? []) showToast({ tone: 'warning', title: w.message });
}
