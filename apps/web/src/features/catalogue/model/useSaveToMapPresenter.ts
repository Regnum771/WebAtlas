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
 *
 * A running copy is followed apart from the open picker: closing the picker or opening another
 * row's does not drop it. Its end shows in the picker when that row's copy picker is open again,
 * otherwise as a toast; the map, quota and uploads are refreshed either way. One copy at a time.
 */
export function useSaveToMapPresenter({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const maps = useQuery({ queryKey: keys.maps, queryFn: ws.listMaps, enabled });
  const [open, setOpen] = useState<SaveToMapState['open']>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The copy being followed and the row it copies; kept when the picker closes.
  const [copying, setCopying] = useState<{ jobId: string; itemId: string } | null>(null);
  const handled = useRef<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const write = useMapWrite(target);

  const targets = (maps.data?.mine ?? []).map((m) => ({ id: m.id, title: m.title }));
  const titleOf = (id: string) => targets.find((t) => t.id === id)?.title ?? '';
  const jobQuery = useJob(copying?.jobId ?? null);
  const followedJob = copying ? jobQuery.data ?? null : null;
  const shownIn = (o: SaveToMapState['open']) => !!copying && o?.mode === 'copy' && o.itemId === copying.itemId;
  // The picker shows the copy only while it is open on the row being copied.
  const job = shownIn(open) ? followedJob : null;

  // A finished copy: its new layers show in their map (opened), as an upload's import does.
  useEffect(() => {
    const finished = followedJob;
    if (!finished || handled.current === finished.id) return;
    const visible = shownIn(openRef.current);
    if (finished.status === 'failed') {
      handled.current = finished.id;
      const message = finished.error ?? 'Chưa sao được. Thử lại.';
      if (visible) setError(message);
      else showToast({ tone: 'error', title: 'Chưa sao được vào Bản của tôi.', body: message });
      return;
    }
    if (finished.status !== 'succeeded' || !finished.mapId) return;
    handled.current = finished.id;
    const layerIds = Array.isArray(finished.result?.layerIds) ? (finished.result.layerIds as string[]) : [];
    expandMap(finished.mapId);
    for (const id of layerIds) setLayerVisible(id, true);
    void qc.invalidateQueries({ queryKey: keys.map(finished.mapId) });
    void qc.invalidateQueries({ queryKey: keys.maps });
    void qc.invalidateQueries({ queryKey: keys.uploads });
    const message = `Đã sao vào “${titleOf(finished.mapId)}”.`;
    if (visible) setDone(message);
    else showToast({ tone: 'success', title: message });
    // titleOf and the open picker are read as they are now; the job is what this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedJob, qc]);

  function start(itemId: string, mode: SaveMode) {
    setOpen({ itemId, mode });
    setTarget((t) => (targets.some((m) => m.id === t) ? t : targets[0]?.id ?? ''));
    setError(null);
    setDone(null);
  }
  function close() {
    setOpen(null);
    setError(null);
    setDone(null);
  }

  const running = followedJob !== null
    ? followedJob.status === 'queued' || followedJob.status === 'running'
    : copying !== null && handled.current !== copying.jobId;

  async function submit(item: CatalogueItem): Promise<void> {
    if (!open || !target || busy) return;
    // One copy at a time: another row's copy waits until the running one has ended.
    if (open.mode === 'copy' && running) return;
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
        setCopying({ jobId: queued.id, itemId: item.id });
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  // A link may be saved meanwhile; a second copy may not.
  const state: SaveToMapState = {
    targets, open, target, busy: busy || (running && open?.mode === 'copy'), error, job, done,
  };
  return { ...state, start, close, setTarget, submit };
}

export type SaveToMapPresenter = ReturnType<typeof useSaveToMapPresenter>;
