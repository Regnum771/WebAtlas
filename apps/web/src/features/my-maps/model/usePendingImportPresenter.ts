import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import { showToast } from '../../../shared/ui/toast.store';
import { expandMap, setLayerVisible } from './myMaps.store';
import { takePendingImport, type PendingImport } from './pendingImports.store';
import { keys, useJob } from './queries';

/** The toast of a finished import: as the dialog says it, with the row count when there is one. */
export function importDoneText(rows: number): string {
  return `Đã nhập xong.${rows > 0 ? ` ${rows} đối tượng.` : ''}`;
}

/**
 * Follows an import its dialog left while it was queued or running. On success its map is read
 * again and opened, its new layers turned on, and a toast says so; on failure the job's error
 * shows as a toast. Either way the import is then forgotten.
 */
export function usePendingImportPresenter({ jobId, mapId }: PendingImport): void {
  const qc = useQueryClient();
  const { data: job, error } = useJob(jobId);

  useEffect(() => {
    // The job is gone (deleted, or another user signed in): nothing left to follow.
    if (error instanceof ApiError && error.status === 404) {
      takePendingImport(jobId);
      return;
    }
    if (!job || (job.status !== 'succeeded' && job.status !== 'failed')) return;
    if (!takePendingImport(jobId)) return;
    if (job.status === 'failed') {
      // The worker's message, as it comes.
      if (job.error) showToast({ tone: 'error', title: job.error });
      return;
    }
    const target = job.mapId ?? mapId;
    void qc.invalidateQueries({ queryKey: keys.maps });
    void qc.invalidateQueries({ queryKey: keys.uploads });
    if (target) {
      void qc.invalidateQueries({ queryKey: keys.map(target) });
      expandMap(target);
    }
    const layerIds = Array.isArray(job.result?.layerIds) ? (job.result.layerIds as string[]) : [];
    for (const id of layerIds) setLayerVisible(id, true);
    const rows = typeof job.result?.rows === 'number' ? job.result.rows : 0;
    showToast({ tone: 'success', title: importDoneText(rows) });
  }, [job, error, jobId, mapId, qc]);
}
