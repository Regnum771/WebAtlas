import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '../../../shared/ui/toast.store';
import * as ws from '../../my-maps/api/workspace.api';
import { expandMap, setLayerVisible } from '../../my-maps/model/myMaps.store';
import { keys, useJob, useMapWrite } from '../../my-maps/model/queries';
import { copyCatalogueItem, type CatalogueItem } from '../api/catalogue.api';
import { removeCatalogueLayer } from './catalogue.store';
import type { SaveMode, SaveToMapState } from './saveToMap';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa thực hiện được. Thử lại.';
}

/**
 * Saving a free-standing catalogue layer into one of the user's own personal maps, as a link
 * (the entry stays in the catalogue; the map shows it through the catalogue's map proxy) or as a
 * copy of its data (vector and raster only: the API reads it from GeoServer and queues the
 * personal-map import, followed here like an upload's import). Signed-in users only.
 */
export function useSaveToMapPresenter({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const maps = useQuery({ queryKey: keys.maps, queryFn: ws.listMaps, enabled });
  const [open, setOpen] = useState<SaveToMapState['open']>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const write = useMapWrite(target);

  const targets = (maps.data?.mine ?? []).map((m) => ({ id: m.id, title: m.title }));
  const titleOf = (id: string) => targets.find((t) => t.id === id)?.title ?? '';
  const jobQuery = useJob(jobId);
  const job = jobId ? jobQuery.data ?? null : null;

  // A finished copy: its new layers show in their map (opened), as an upload's import does.
  useEffect(() => {
    if (!job || handled.current === job.id) return;
    if (job.status === 'failed') {
      handled.current = job.id;
      setError(job.error ?? 'Chưa sao được. Thử lại.');
      return;
    }
    if (job.status !== 'succeeded' || !job.mapId) return;
    handled.current = job.id;
    const layerIds = Array.isArray(job.result?.layerIds) ? (job.result.layerIds as string[]) : [];
    expandMap(job.mapId);
    for (const id of layerIds) setLayerVisible(id, true);
    void qc.invalidateQueries({ queryKey: keys.map(job.mapId) });
    void qc.invalidateQueries({ queryKey: keys.maps });
    void qc.invalidateQueries({ queryKey: keys.uploads });
    setDone(`Đã sao vào “${titleOf(job.mapId)}”.`);
    // titleOf reads the current list; the job is what this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, qc]);

  function start(itemId: string, mode: SaveMode) {
    setOpen({ itemId, mode });
    setTarget((t) => (targets.some((m) => m.id === t) ? t : targets[0]?.id ?? ''));
    setError(null);
    setDone(null);
    setJobId(null);
  }
  function close() {
    setOpen(null);
    setError(null);
    setDone(null);
    setJobId(null);
  }

  async function submit(item: CatalogueItem): Promise<void> {
    if (!open || !target || busy) return;
    const mapId = target;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (open.mode === 'link') {
        const { layer } = await write.run((expectedRevision) => ws.addCatalogueLink(mapId, { resourceId: item.id, expectedRevision }));
        // The entry now lives in the map: shown there, no longer as a free-standing layer drawn twice.
        expandMap(mapId);
        setLayerVisible(layer.id, true);
        removeCatalogueLayer(item.id);
        showToast({ tone: 'success', title: `Đã lưu “${item.title}” vào “${titleOf(mapId)}”.` });
        setOpen(null);
      } else {
        const { job: queued } = await copyCatalogueItem(item.id, mapId);
        qc.setQueryData(keys.job(queued.id), queued);
        setJobId(queued.id);
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const running = job !== null && (job.status === 'queued' || job.status === 'running');
  const state: SaveToMapState = { targets, open, target, busy: busy || running, error, job, done };
  return { ...state, start, close, setTarget, submit };
}

export type SaveToMapPresenter = ReturnType<typeof useSaveToMapPresenter>;
