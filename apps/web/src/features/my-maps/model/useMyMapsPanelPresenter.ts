import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/workspace.api';
import type { FieldDef, GeometryType, LayerKind, MapSummary } from '../api/workspace.api';
import { showToast } from '../../../shared/ui/toast.store';
import { keys, MapGoneError, useMapWrite, useMyMaps, useUploads } from './queries';
import { layerKindLabel } from './layerKindLabel';
import { parseStyle, type PersonalLayerStyle } from './personalStyle';
import {
  expandMap, forgetMap, layerView, setLayerOpacity, setLayerVisible, toggleCollapsed, toggleExpanded, useMyMapsStore,
} from './myMaps.store';

export interface LayerRowData {
  id: string;
  kind: LayerKind;
  title: string;
  kindLabel: string;
  visible: boolean;
  opacity: number;
  /** The last viewport read was cut at this many features; null when it was complete. */
  truncated: number | null;
  /** For the owner's settings: the stored style (defaults filled in), geometry, fields and place in the order. */
  style: PersonalLayerStyle;
  geometryType: GeometryType | null;
  fields: FieldDef[];
  isFirst: boolean;
  isLast: boolean;
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

  // Writes go through useMapWrite, which sends the revision of the last read of the map.
  const renameWrite = useMapWrite(dialog.mapId ?? '');
  const deleteWrite = useMapWrite(deleteId ?? '');

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
        ? [...detail.layers].sort((a, b) => a.position - b.position).map((l, i, all) => ({
          id: l.id, kind: l.kind, title: l.title, kindLabel: layerKindLabel(l), ...layerView(l.id),
          truncated: store.truncated[l.id] ?? null,
          style: parseStyle(l.style), geometryType: l.geometryType, fields: l.fields,
          isFirst: i === 0, isLast: i === all.length - 1,
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
        const mapId = dialog.mapId as string;
        await renameWrite.run((expectedRevision) => api.updateMap(mapId, { title, expectedRevision }));
      }
      setDialog(CLOSED);
    } catch (e) {
      if (e instanceof MapGoneError) {
        // The map was deleted or unshared elsewhere: drop it and close the dialog.
        goneCleanup(dialog.mapId, e);
        setDialog(CLOSED);
        return;
      }
      // MapChangedError already refetched the map; the typed title stays for a retry.
      setDialog((d) => ({ ...d, busy: false, error: messageOf(e) }));
    }
  }

  function goneCleanup(mapId: string | null, e: MapGoneError) {
    if (mapId) forgetMap(mapId, detailOf.get(mapId)?.layers.map((l) => l.id) ?? []);
    showToast({ tone: 'warning', title: e.message });
  }

  const askDelete = (mapId: string) => { setDeleteError(null); setDeleteId(mapId); };
  const cancelDelete = () => { setDeleteId(null); setDeleteError(null); };
  async function confirmDelete(): Promise<void> {
    if (deleteId === null) return;
    const mapId = deleteId;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWrite.run((expectedRevision) => api.deleteMap(mapId, expectedRevision));
      forgetMap(mapId, detailOf.get(mapId)?.layers.map((l) => l.id) ?? []);
      qc.removeQueries({ queryKey: keys.map(mapId) });
      setDeleteId(null);
    } catch (e) {
      if (e instanceof MapGoneError) {
        goneCleanup(mapId, e);
        setDeleteId(null);
      } else {
        setDeleteError(messageOf(e));
      }
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
