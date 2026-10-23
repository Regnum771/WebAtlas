import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import { showToast } from '../../../shared/ui/toast.store';
import type { MapDetail, MapSummary } from '../api/workspace.api';
import { forgetMap } from './myMaps.store';

export const keys = {
  maps: ['ws', 'maps'] as const,
  map: (id: string) => ['ws', 'map', id] as const,
  uploads: ['ws', 'uploads'] as const,
  job: (id: string) => ['ws', 'job', id] as const,
  jobs: (mapId: string) => ['ws', 'jobs', mapId] as const,
  shares: (mapId: string) => ['ws', 'shares', mapId] as const,
};

export const MAP_CHANGED_COPY = 'Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.';
export const MAP_GONE_COPY = 'Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.';
/** The API's 404 message for a map the user cannot read (apps/api workspace/access.ts). */
export const MAP_NOT_FOUND = 'Không tìm thấy bản đồ.';

export class MapChangedError extends Error {
  constructor() {
    super(MAP_CHANGED_COPY);
    this.name = 'MapChangedError';
  }
}
export class MapGoneError extends Error {
  constructor() {
    super(MAP_GONE_COPY);
    this.name = 'MapGoneError';
  }
}

/** True for the map's own 404; a missing layer or feature answers 404 too and is not a lost map. */
export function isMapNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && e.message === MAP_NOT_FOUND;
}

/**
 * A map the user can no longer read (revoked or deleted): it leaves the lists, its layers leave the
 * map and a toast says so. The map and its detail are always forgotten (a focus refetch of the list
 * may have dropped it already while its card and layers were still shown); the toast comes once,
 * while the map is still listed or its detail cached, so a second call (another layer's read,
 * another observer) is silent.
 */
export function dropGoneMap(qc: QueryClient, mapId: string, layerIds: string[] = []): void {
  const lists = qc.getQueryData<{ mine: MapSummary[]; sharedWithMe: MapSummary[] }>(keys.maps);
  const listed = lists !== undefined && [...lists.mine, ...lists.sharedWithMe].some((m) => m.id === mapId);
  const detail = qc.getQueryData<MapDetail>(keys.map(mapId));
  const known = detail?.layers.map((l) => l.id) ?? [];
  forgetMap(mapId, [...new Set([...layerIds, ...known])]);
  qc.removeQueries({ queryKey: keys.map(mapId) });
  if (!listed && detail === undefined) return;
  if (lists && listed) {
    qc.setQueryData(keys.maps, {
      ...lists,
      mine: lists.mine.filter((m) => m.id !== mapId),
      sharedWithMe: lists.sharedWithMe.filter((m) => m.id !== mapId),
    });
  }
  void qc.invalidateQueries({ queryKey: keys.maps });
  showToast({ tone: 'warning', title: MAP_GONE_COPY });
}

const POLL_MS = 1000;

/**
 * The user's maps and the maps shared with them. Read again when the window regains focus (the
 * app's default is not to), so a share revoked or added elsewhere shows up.
 */
export function useMyMaps() {
  return useQuery({ queryKey: keys.maps, queryFn: api.listMaps, refetchOnWindowFocus: true });
}

/**
 * The query of an open card's map detail. A shared map's detail is read again on window focus,
 * so a revoked share is noticed (its 404 drops the map) without waiting for a viewport read.
 */
export function mapDetailQuery(m: Pick<MapSummary, 'id' | 'role'>) {
  return {
    queryKey: keys.map(m.id),
    queryFn: () => api.getMap(m.id),
    refetchOnWindowFocus: m.role === 'recipient',
  };
}

export function useMapDetail(id: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.map(id ?? ''),
    queryFn: () => api.getMap(id as string),
    enabled: id !== null,
  });
  // The map's own 404 on a read: it was unshared or deleted.
  useEffect(() => {
    if (id !== null && isMapNotFound(query.error)) dropGoneMap(qc, id);
  }, [id, query.error, qc]);
  return query;
}

export function useUploads() {
  return useQuery({ queryKey: keys.uploads, queryFn: api.listUploads });
}

/**
 * A job, polled every second while queued or running. Polling stops on a final status, on a 401
 * (the session is over) or when the asking component unmounts; any other error (a network blip)
 * keeps polling, so the dialog does not sit on "running" for good.
 */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: keys.job(id ?? ''),
    queryFn: () => api.getJob(id as string),
    enabled: id !== null,
    refetchInterval: (query) => {
      const error = query.state.error;
      if (error instanceof ApiError && error.status === 401) return false;
      const status = query.state.data?.status;
      return status === 'succeeded' || status === 'failed' ? false : POLL_MS;
    },
  });
}

export function useMapJobs(mapId: string) {
  return useQuery({ queryKey: keys.jobs(mapId), queryFn: () => api.listJobs({ mapId }) });
}

export interface MapWriteOptions<T> {
  /** False: the caller patches the cached map itself (in `after`), so no refetch can overwrite newer local state. */
  refetch?: boolean;
  /** Runs after the revision is advanced and the cache refreshed, before the next queued write starts. */
  after?: (result: T) => void;
}

/** Per map: the tail of its write chain, so writes to one map run one at a time. */
const chains = new Map<string, Promise<unknown>>();

/**
 * Runs a write on a map with the revision of the last read. Writes to one map are queued: each
 * starts after the previous one settled, and a successful write moves the cached revision to the
 * one the API answered, so the next write never sends a stale one. A stale revision (another tab)
 * refetches the map and throws MapChangedError; the map's 404 drops it from the cache and throws
 * MapGoneError.
 */
export function useMapWrite(mapId: string) {
  const qc = useQueryClient();
  async function runNow<T>(write: (expectedRevision: number) => Promise<T>, options: MapWriteOptions<T>): Promise<T> {
    const refresh = () =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.map(mapId) }), qc.invalidateQueries({ queryKey: keys.maps })]);
    try {
      // An uncached map is read first, so a cold start does not send a made-up revision.
      const map =
        qc.getQueryData<MapDetail>(keys.map(mapId)) ??
        (await qc.fetchQuery<MapDetail>({ queryKey: keys.map(mapId), queryFn: () => api.getMap(mapId) }));
      const revision = map.revision;
      const result = await write(revision);
      const answered = (result as { revision?: unknown } | null)?.revision;
      if (typeof answered === 'number') {
        qc.setQueryData<MapDetail>(keys.map(mapId), (d) => (d ? { ...d, revision: answered } : d));
      }
      if (options.refetch === false) await qc.invalidateQueries({ queryKey: keys.maps });
      else await refresh();
      options.after?.(result);
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MAP_CHANGED') {
        await refresh();
        throw new MapChangedError();
      }
      // Only the map's own 404 means the map is gone; a missing layer or feature is the caller's to handle.
      if (isMapNotFound(e)) {
        qc.removeQueries({ queryKey: keys.map(mapId) });
        await qc.invalidateQueries({ queryKey: keys.maps });
        throw new MapGoneError();
      }
      throw e;
    }
  }
  function run<T>(write: (expectedRevision: number) => Promise<T>, options: MapWriteOptions<T> = {}): Promise<T> {
    const task = (chains.get(mapId) ?? Promise.resolve()).catch(() => undefined).then(() => runNow(write, options));
    chains.set(mapId, task);
    const clear = () => { if (chains.get(mapId) === task) chains.delete(mapId); };
    task.then(clear, clear);
    return task;
  }
  return { run };
}
