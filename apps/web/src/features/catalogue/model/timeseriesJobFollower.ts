import { ApiError } from '../../../shared/api/apiClient';
import { showToast } from '../../../shared/ui/toast.store';
import { getJob } from '../../my-maps/api/workspace.api';
import { getCatalogueItem } from '../api/catalogue.api';
import { addCatalogueLayer } from './catalogue.store';

/** How often a job is asked after its dialog closed. */
export const FOLLOW_POLL_MS = 2000;

const followed = new Set<string>();
// Bumped by resetFollowedJobs: a poll of an earlier generation stops.
let generation = 0;

/**
 * Keeps following a time-series import after its upload dialog was closed (a HEC-RAS job runs for
 * many minutes): once it succeeds, its entry goes on the map as the dialog would have put it, with
 * a toast; a failure is told in a toast. Polling stops at the end, or when the job is gone or the
 * session is no longer allowed to read it.
 */
export function followTimeseriesJob(jobId: string): void {
  if (followed.has(jobId)) return;
  followed.add(jobId);
  const mine = generation;
  const again = () => { setTimeout(() => { void tick(); }, FOLLOW_POLL_MS); };
  const stop = () => { followed.delete(jobId); };

  async function tick(): Promise<void> {
    if (mine !== generation) return;
    let job;
    try {
      job = await getJob(jobId);
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) stop();
      else again();
      return;
    }
    if (mine !== generation || !job) return;
    if (job.status === 'queued' || job.status === 'running') {
      again();
      return;
    }
    stop();
    if (job.status === 'failed') {
      showToast({ tone: 'error', title: 'Chuỗi thời gian chưa đưa lên được Danh mục.', body: job.error ?? undefined });
      return;
    }
    const id = job.result?.resourceId;
    if (typeof id !== 'string') return;
    try {
      const item = await getCatalogueItem(id);
      addCatalogueLayer(item);
      showToast({ tone: 'success', title: `Đã thêm “${item.title}” vào bản đồ.` });
    } catch {
      showToast({ tone: 'error', title: 'Đã xử lý xong nhưng chưa mở được mục trong Danh mục.' });
    }
  }

  void tick();
}

/** Test seam: forget every followed job. */
export function resetFollowedJobs(): void {
  followed.clear();
  generation++;
}
