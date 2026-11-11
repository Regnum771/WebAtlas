import { apiRequest, ApiError, getAuthToken, notifyUnauthorized } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';
import type { Job } from '../../my-maps/api/workspace.api';

// Types mirror apps/api/src/modules/catalogue.

export type CatalogueKind = 'vector' | 'raster' | 'timeseries' | 'map' | 'document';

export interface CatalogueItem {
  id: string;
  kind: CatalogueKind;
  title: string;
  abstract: string;
  managingUnit: string | null;
  isPublished: boolean;
  /** Seen by everyone: published, and GeoNode lets anonymous users view it. */
  isPublic?: boolean;
  mine: boolean;
  /** The caller may copy its data into Bản của tôi (GeoNode's anonymous download, or theirs). */
  downloadable?: boolean;
  variable: string | null;
  unit: string | null;
  timeSteps: string[] | null;
  bbox4326: [number, number, number, number] | null;
  layerName: string;
}

export interface CatalogueSearchResult {
  items: CatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type TimePattern = 'YYYYMMDD' | 'YYYYMMDDHHmm' | 'YYYYDDD';
/** The clock of a HEC-RAS file's time stamps (the worker converts them to UTC). */
export type HdfTimeZone = 'Asia/Ho_Chi_Minh' | 'UTC';
/** [minLon, minLat, maxLon, maxLat] in EPSG:4326. */
export type Clip4326 = [number, number, number, number];

export interface TimeseriesInput {
  fileId: string;
  title: string;
  abstract?: string;
  timePattern?: TimePattern;
  timesCsvFileId?: string;
  hdfArea?: string;
  every?: 1 | 4;
  clip4326?: Clip4326;
  hdfTimeZone?: HdfTimeZone;
}

export interface CatalogueUpload {
  id: string;
  originalName: string;
  sizeBytes: number;
}

const BASE = '/api/catalogue';

export function searchCatalogue(q: { q?: string; kind?: CatalogueKind | ''; page?: number }): Promise<CatalogueSearchResult> {
  const params = new URLSearchParams();
  if (q.q?.trim()) params.set('q', q.q.trim());
  if (q.kind) params.set('kind', q.kind);
  params.set('page', String(q.page ?? 1));
  return apiRequest<CatalogueSearchResult>(`${BASE}/search?${params}`);
}

export function getCatalogueItem(id: string): Promise<CatalogueItem> {
  return apiRequest<CatalogueItem>(`${BASE}/${encodeURIComponent(id)}`);
}

/** The WMS proxy of one entry; every request to it must carry the token (see fetchCatalogueBlob). */
export function catalogueWmsUrl(id: string): string {
  return `${API_BASE_URL}${BASE}/${encodeURIComponent(id)}/wms`;
}

export async function uploadCatalogueFile(file: File, signal?: AbortSignal): Promise<CatalogueUpload> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiRequest<{ upload: CatalogueUpload }>(`${BASE}/uploads`, {
    method: 'POST', body: form, ...(signal ? { signal } : {}),
  });
  return res.upload;
}

export function createTimeseries(input: TimeseriesInput): Promise<{ job: Job }> {
  return apiRequest<{ job: Job }>(`${BASE}/timeseries`, { method: 'POST', body: JSON.stringify(input) });
}

/**
 * "Sao vào Bản của tôi": queues an import of a vector or raster entry's data into one of the
 * caller's own maps (202 {job}); other kinds are refused with the API's message.
 */
export function copyCatalogueItem(id: string, mapId: string): Promise<{ job: Job }> {
  return apiRequest<{ job: Job }>(`${BASE}/${encodeURIComponent(id)}/copy`, { method: 'POST', body: JSON.stringify({ mapId }) });
}

/**
 * GETs a catalogue URL with the Bearer token (when signed in) and returns a blob URL for it.
 * The caller revokes the URL once the image has loaded.
 */
export async function fetchCatalogueBlob(url: string, signal?: AbortSignal): Promise<string> {
  const res = await authorisedGet(url, signal);
  const blob = await res.blob();
  // A superseded request must not leave a blob URL behind.
  if (signal?.aborted) throw new ApiError(0, 'ABORTED', 'Đã huỷ.');
  return URL.createObjectURL(blob);
}

/** GETs a catalogue URL with the token and parses the JSON body (GetFeatureInfo). */
export async function fetchCatalogueJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await authorisedGet(url, signal);
  return (await res.json()) as T;
}

async function authorisedGet(url: string, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Network request failed');
  }
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }
  return res;
}

/** A legend image for the entry, as a blob URL (token-authorized like the map images). */
export function fetchCatalogueLegend(item: Pick<CatalogueItem, 'id' | 'layerName'>, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetLegendGraphic', FORMAT: 'image/png', LAYER: item.layerName,
  });
  return fetchCatalogueBlob(`${catalogueWmsUrl(item.id)}?${params}`, signal);
}
