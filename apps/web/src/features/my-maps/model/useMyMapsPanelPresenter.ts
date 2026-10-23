import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { MapSummary } from '../api/workspace.api';
import { keys, MAP_CHANGED_COPY, useMyMaps, useUploads } from './queries';
import { layerKindLabel } from './layerKindLabel';
import {
  expandMap, forgetMap, layerView, setLayerOpacity, setLayerVisible, toggleCollapsed, toggleExpanded, useMyMapsStore,
} from './myMaps.store';

export interface LayerRowData {
  id: string;
  title: string;
  kindLabel: string;
  visible: boolean;
  opacity: number;
}
export interface MapCardData {
  id: string;
  title: string;
  /** `của {owner}` on a shared map, else null. */
  ownerLabel: string | null;
  layerCount: number;
  expanded: boolean;
  /** Only the owner may rename or delete. */
  canWrite: boolean;
  /** Null until the map's detail has loaded. */
  layers: LayerRowData[] | null;
}

type DialogMode = 'create' | 'rename';
export interface DialogState { open: boolean; mode: DialogMode; mapId: string | null; title: string; error: string | null; busy: boolean }
const CLOSED: DialogState = { open: false, mode: 'create', mapId: null, title: '', error: null, busy: false };

function messageOf(e: unknown): string {
  if (e instanceof ApiError && e.code === 'MAP_CHANGED') return MAP_CHANGED_COPY;
  return e instanceof Error ? e.message : 'Chưa lưu được. Thử lại.';
}

export function useMyMapsPanelPresenter() {
  const qc = useQueryClient();
  const store = useMyMapsStore();
  const maps = useMyMaps();
  const uploads = useUploads();
  const mine = maps.data?.mine ?? [];
  const sharedWithMe = maps.data?.sharedWithMe ?? [];
  const all = [...mine, ...sharedWithMe];

  const expandedIds = all.filter((m) => store.expanded.has(m.id)).map((m) => m.id);
  const details = useQueries({
    queries: expandedIds.map((id) => ({ queryKey: keys.map(id), queryFn: () => api.getMap(id) })),
  });
  const detailOf = new Map(expandedIds.map((id, i) => [id, details[i].data]));

  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const card = (m: MapSummary): MapCardData => {
    const expanded = store.expanded.has(m.id);
    const detail = detailOf.get(m.id);
    return {
      id: m.id,
      title: m.title,
      ownerLabel: m.role === 'recipient' ? `của ${m.ownerName}` : null,
      layerCount: m.layerCount,
      expanded,
      canWrite: m.role === 'owner',
      layers: expanded && detail
        ? [...detail.layers].sort((a, b) => a.position - b.position).map((l) => ({
          id: l.id, title: l.title, kindLabel: layerKindLabel(l), ...layerView(l.id),
        }))
        : null,
    };
  };

  const refreshMaps = () => qc.invalidateQueries({ queryKey: keys.maps });

  const openCreate = () => setDialog({ ...CLOSED, open: true, mode: 'create' });
  const openRename = (mapId: string) => {
    const m = all.find((x) => x.id === mapId);
    if (m) setDialog({ ...CLOSED, open: true, mode: 'rename', mapId, title: m.title });
  };
  const closeDialog = () => setDialog(CLOSED);
  const setTitle = (title: string) => setDialog((d) => ({ ...d, title, error: null }));

  async function submit(): Promise<void> {
    const title = dialog.title.trim();
    if (!title) {
      setDialog((d) => ({ ...d, error: 'Hãy nhập tên bản đồ.' }));
      return;
    }
    setDialog((d) => ({ ...d, busy: true, error: null }));
    try {
      if (dialog.mode === 'create') {
        const created = await api.createMap({ title });
        await refreshMaps();
        expandMap(created.id);
      } else {
        const target = all.find((m) => m.id === dialog.mapId);
        if (!target) throw new Error('Bản đồ không còn trong danh sách.');
        await api.updateMap(target.id, { title, expectedRevision: target.revision });
        await Promise.all([refreshMaps(), qc.invalidateQueries({ queryKey: keys.map(target.id) })]);
      }
      setDialog(CLOSED);
    } catch (e) {
      // A stale revision reloads the list; the typed title stays for a retry.
      if (e instanceof ApiError && e.code === 'MAP_CHANGED') await refreshMaps();
      setDialog((d) => ({ ...d, busy: false, error: messageOf(e) }));
    }
  }

  const askDelete = (mapId: string) => { setDeleteError(null); setDeleteId(mapId); };
  const cancelDelete = () => { setDeleteId(null); setDeleteError(null); };
  async function confirmDelete(): Promise<void> {
    const target = all.find((m) => m.id === deleteId);
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteMap(target.id, target.revision);
      forgetMap(target.id, detailOf.get(target.id)?.layers.map((l) => l.id) ?? []);
      qc.removeQueries({ queryKey: keys.map(target.id) });
      await refreshMaps();
      setDeleteId(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MAP_CHANGED') await refreshMaps();
      setDeleteError(messageOf(e));
    } finally {
      setDeleting(false);
    }
  }

  return {
    loading: maps.isLoading,
    error: maps.error ? messageOf(maps.error) : null,
    retry: () => { void maps.refetch(); },
    collapsed: store.collapsed,
    toggleCollapsed,
    own: mine.map(card),
    shared: sharedWithMe.map(card),
    usage: uploads.data ? { usageBytes: uploads.data.usageBytes, quotaBytes: uploads.data.quotaBytes } : null,
    toggleExpanded,
    setLayerVisible,
    setLayerOpacity,
    dialog,
    openCreate,
    openRename,
    closeDialog,
    setTitle,
    submit,
    pendingDelete: deleteId !== null,
    deleteError,
    deleting,
    askDelete,
    cancelDelete,
    confirmDelete,
  };
}
