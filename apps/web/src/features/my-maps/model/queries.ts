import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { MapDetail } from '../api/workspace.api';

export const keys = {
  maps: ['ws', 'maps'] as const,
  map: (id: string) => ['ws', 'map', id] as const,
  uploads: ['ws', 'uploads'] as const,
  job: (id: string) => ['ws', 'job', id] as const,
  jobs: (mapId: string) => ['ws', 'jobs', mapId] as const,
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

const POLL_MS = 1000;

export function useMyMaps() {
  return useQuery({ queryKey: keys.maps, queryFn: api.listMaps });
}

export function useMapDetail(id: string | null) {
  return useQuery({
    queryKey: keys.map(id ?? ''),
    queryFn: () => api.getMap(id as string),
    enabled: id !== null,
  });
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

/**
 * Runs a write on a map with the revision of the last read. A stale revision refetches the map
 * and throws MapChangedError; the map's 404 drops it from the cache and throws MapGoneError.
 */
export function useMapWrite(mapId: string) {
  const qc = useQueryClient();
  async function run<T>(write: (expectedRevision: number) => Promise<T>): Promise<T> {
    const refresh = () =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.map(mapId) }), qc.invalidateQueries({ queryKey: keys.maps })]);
    try {
      // An uncached map is read first, so a cold start does not send a made-up revision.
      const map =
        qc.getQueryData<MapDetail>(keys.map(mapId)) ??
        (await qc.fetchQuery<MapDetail>({ queryKey: keys.map(mapId), queryFn: () => api.getMap(mapId) }));
      const revision = map.revision;
      const result = await write(revision);
      await refresh();
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MAP_CHANGED') {
        await refresh();
        throw new MapChangedError();
      }
      // Only the map's own 404 means the map is gone; a missing layer or feature is the caller's to handle.
      if (e instanceof ApiError && e.status === 404 && e.message === MAP_NOT_FOUND) {
        qc.removeQueries({ queryKey: keys.map(mapId) });
        await qc.invalidateQueries({ queryKey: keys.maps });
        throw new MapGoneError();
      }
      throw e;
    }
  }
  return { run };
}
