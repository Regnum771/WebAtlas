import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMapContext } from '../../../app/providers/MapProvider';
import { showToast } from '../../../shared/ui/toast.store';
import * as api from '../api/workspace.api';
import type { FieldEdit, GeometryType, MapDetail } from '../api/workspace.api';
import { setLayerVisible } from './myMaps.store';
import { refreshPersonalLayer } from './personalLayers';
import { parseStyle, type PersonalLayerStyle } from './personalStyle';
import { keys, MapGoneError, useMapWrite } from './queries';

/** A style change is saved this long after the last one. */
export const STYLE_SAVE_DELAY_MS = 500;

/**
 * What a layer write answers: null when it is done (or the map is gone, which the panel handles),
 * else the message to show. The caller's form keeps what was typed, so the user can retry.
 */
export type WriteResult = string | null;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa lưu được. Thử lại.';
}

interface PendingStyle { style: PersonalLayerStyle; timer: ReturnType<typeof setTimeout> }

/** The layer writes of one map's panel: new layers, rename, style, order, fields, delete. */
export function useLayerEditorPresenter(mapId: string) {
  const qc = useQueryClient();
  const { map } = useMapContext();
  const write = useMapWrite(mapId);
  const pending = useRef(new Map<string, PendingStyle>());

  /** Puts the style changes still waiting to be saved back over what a refetch brought in. */
  function reapplyPending(): void {
    if (pending.current.size === 0) return;
    qc.setQueryData<MapDetail>(keys.map(mapId), (d) => d && {
      ...d,
      layers: d.layers.map((l) => {
        const queued = pending.current.get(l.id);
        return queued ? { ...l, style: { ...queued.style } } : l;
      }),
    });
  }
  const after = { after: reapplyPending };

  async function guard(action: () => Promise<void>): Promise<WriteResult> {
    try {
      await action();
      return null;
    } catch (e) {
      reapplyPending();
      if (e instanceof MapGoneError) {
        showToast({ tone: 'warning', title: e.message });
        return null;
      }
      return messageOf(e);
    }
  }

  const detail = () => qc.getQueryData<MapDetail>(keys.map(mapId));

  const createDrawn = (input: { title: string; geometryType: GeometryType; fields: { name: string; type: 'text' | 'number' | 'date' }[] }) =>
    guard(async () => {
      const fields = input.fields.map((f) => ({ name: f.name.trim(), type: f.type })).filter((f) => f.name !== '');
      const { layer } = await write.run((expectedRevision) =>
        api.addFreeLayer(mapId, { title: input.title.trim(), geometryType: input.geometryType, fields, expectedRevision }), after);
      setLayerVisible(layer.id, true);
    });

  const createEditCopy = (layerKey: string) =>
    guard(async () => {
      const { layer } = await write.run((expectedRevision) => api.addEditCopy(mapId, { layerKey, expectedRevision }), after);
      setLayerVisible(layer.id, true);
    });

  const rename = (layerId: string, title: string) =>
    guard(async () => {
      await write.run((expectedRevision) => api.updateLayer(mapId, layerId, { title: title.trim(), expectedRevision }), after);
    });

  async function saveStyle(layerId: string, style: PersonalLayerStyle): Promise<void> {
    const failure = await guard(async () => {
      await write.run((expectedRevision) => api.updateLayer(mapId, layerId, { style: { ...style }, expectedRevision }), {
        // No refetch: patch the saved layer in and keep any newer pending style over it, so nothing snaps back.
        refetch: false,
        after: ({ layer }) => {
          qc.setQueryData<MapDetail>(keys.map(mapId), (d) =>
            d && { ...d, layers: d.layers.map((l) => (l.id === layer.id ? { ...layer, style: { ...layer.style } } : l)) });
          reapplyPending();
        },
      });
    });
    if (failure) showToast({ tone: 'error', title: failure });
  }

  /** Applies the change to the cached layer at once (the map redraws) and saves after a quiet moment. */
  function setStyle(layerId: string, change: Partial<PersonalLayerStyle>): void {
    const queued = pending.current.get(layerId);
    const current = queued?.style ?? parseStyle(detail()?.layers.find((l) => l.id === layerId)?.style ?? {});
    const style = { ...current, ...change };
    if (queued) clearTimeout(queued.timer);
    qc.setQueryData<MapDetail>(keys.map(mapId), (d) =>
      d ? { ...d, layers: d.layers.map((l) => (l.id === layerId ? { ...l, style: { ...style } } : l)) } : d);
    const timer = setTimeout(() => {
      pending.current.delete(layerId);
      void saveStyle(layerId, style);
    }, STYLE_SAVE_DELAY_MS);
    pending.current.set(layerId, { style, timer });
  }

  // Closing the dialog inside the quiet moment still saves the last change.
  useEffect(() => {
    const queue = pending.current;
    return () => {
      for (const [layerId, p] of queue) {
        clearTimeout(p.timer);
        void saveStyle(layerId, p.style);
      }
      queue.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushes the queue as it was at unmount
  }, []);

  const move = (layerId: string, direction: 'up' | 'down') =>
    guard(async () => {
      await write.run(async (expectedRevision) => {
        // Read when the write runs (after earlier queued writes), not when the button was pressed.
        const layers = [...(detail()?.layers ?? [])].sort((a, b) => a.position - b.position);
        const at = layers.findIndex((l) => l.id === layerId);
        const neighbour = layers[direction === 'up' ? at - 1 : at + 1];
        if (at < 0 || !neighbour) return { revision: expectedRevision };
        return api.updateLayer(mapId, layerId, { position: neighbour.position, expectedRevision });
      }, after);
    });

  const saveFields = (layerId: string, fields: FieldEdit[]) =>
    guard(async () => {
      await write.run((expectedRevision) => api.updateLayer(mapId, layerId, { fields, expectedRevision }), after);
      // Renamed and removed fields change every feature's properties: read the view again.
      if (map) refreshPersonalLayer(map, layerId);
    });

  const remove = (layerId: string) =>
    guard(async () => {
      await write.run((expectedRevision) => api.removeLayer(mapId, layerId, expectedRevision), after);
      // Usage (Đã dùng) counts the layer's features and files: read it again.
      void qc.invalidateQueries({ queryKey: keys.uploads });
    });

  return { createDrawn, createEditCopy, rename, setStyle, move, saveFields, remove };
}
