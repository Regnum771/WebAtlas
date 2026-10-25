import { apiRequest } from '../../../shared/api/apiClient';

// Types mirror apps/api/src/modules/workspace (dates arrive as ISO strings over JSON).

export type MapRole = 'owner' | 'recipient';
export type LayerKind = 'free' | 'edit_copy' | 'raster' | 'annotation';
export type GeometryType = 'point' | 'line' | 'polygon';

export interface FieldDef {
  name: string;
  type: 'text' | 'number' | 'date';
}
/** A field in a layer PATCH: `from` names the declared field it renames. */
export interface FieldEdit extends FieldDef {
  from?: string;
}

export interface LayerSummary {
  id: string;
  kind: LayerKind;
  title: string;
  position: number;
  style: Record<string, unknown>;
  geometryType: GeometryType | null;
  fields: FieldDef[];
  layerKey: string | null;
  draftId: string | null;
  featureCount: number | null;
  raster: Record<string, unknown> | null;
}

export interface MapSummary {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  updatedAt: string;
  layerCount: number;
  role: MapRole;
}

export type MapDetail = MapSummary & { layers: LayerSummary[] };

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface JobStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  message?: string;
}
export interface Job {
  id: string;
  kind: 'import' | 'export';
  status: JobStatus;
  mapId: string | null;
  progress: number;
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Share {
  id: string;
  userId: string | null;
  groupId: string | null;
  name: string;
  createdAt: string;
}
export interface ShareTargets {
  users: { id: string; name: string; email: string }[];
  groups: { id: string; name: string }[];
}

export interface Upload {
  id: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
}

export type ExportFormat = 'gpkg' | 'geojson' | 'shp';
export interface ExportRequest {
  format: ExportFormat;
  crs: string;
  layerIds?: string[];
}
export interface ExportPreview {
  layers: { layerId: string; title: string; truncated: { from: string; to: string }[] }[];
  warnings: string[];
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown[];
  [key: string]: unknown;
}
export interface PersonalFeature {
  type: 'Feature';
  id: string;
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
}
export interface FeatureCollectionResponse {
  type: 'FeatureCollection';
  features: PersonalFeature[];
  truncated: boolean;
  /** Edit copies only: ids of the features changed in the draft. */
  changed?: string[];
}
export interface FeatureWarning {
  [key: string]: unknown;
}

export interface OwnerSummary {
  userId: string;
  email: string;
  maps: number;
  layers: number;
  features: number;
  bytes: number;
  usageBytes: number;
  quotaBytes: number;
}

// --- Layer table query (mirrors apps/api workspace/layerTable.ts) -------------------------

export interface TableColumn {
  name: string;
  type: 'text' | 'number' | 'date';
}
export interface TableCondition {
  field: string;
  op: string;
  value?: string | number;
  /** Request only: eq/neq on a number column match within this distance (stored units). */
  tolerance?: number;
}
export interface TableRow {
  id: string;
  properties: Record<string, unknown>;
  /** [minX, minY, maxX, maxY] in EPSG:4326, or null for a feature without geometry. */
  bbox: [number, number, number, number] | null;
}
export interface LayerQueryRequest {
  q?: string;
  conditions: TableCondition[];
  match: 'all' | 'any';
  bbox?: [number, number, number, number];
  sort?: { field: string; dir: 'asc' | 'desc' };
  offset: number;
  limit: number;
  /** A feature id whose position in the sorted, filtered result is wanted. */
  locate?: string;
}
export interface LayerQueryResponse {
  columns: TableColumn[];
  total: number;
  matched: number;
  rows: TableRow[];
  position: number | null;
}

const BASE = '/api/workspace';
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

// --- Maps ---------------------------------------------------------------------------------

export function listMaps(): Promise<{ mine: MapSummary[]; sharedWithMe: MapSummary[] }> {
  return apiRequest(`${BASE}/maps`);
}
export function getMap(id: string): Promise<MapDetail> {
  return apiRequest<{ map: MapDetail }>(`${BASE}/maps/${id}`).then((r) => r.map);
}
export function createMap(input: { title: string; description?: string }): Promise<MapDetail> {
  return apiRequest<{ map: MapDetail }>(`${BASE}/maps`, json('POST', input)).then((r) => r.map);
}
export function updateMap(
  id: string,
  input: { title?: string; description?: string; expectedRevision: number }
): Promise<MapDetail> {
  return apiRequest<{ map: MapDetail }>(`${BASE}/maps/${id}`, json('PATCH', input)).then((r) => r.map);
}
export function deleteMap(id: string, expectedRevision: number): Promise<void> {
  return apiRequest<void>(`${BASE}/maps/${id}`, json('DELETE', { expectedRevision }));
}
export function copyMap(id: string): Promise<MapDetail> {
  return apiRequest<{ map: MapDetail }>(`${BASE}/maps/${id}/copy`, { method: 'POST' }).then((r) => r.map);
}

// --- Layers -------------------------------------------------------------------------------

export function addFreeLayer(
  mapId: string,
  input: { title: string; geometryType: GeometryType; fields: FieldDef[]; style?: Record<string, unknown>; expectedRevision: number }
): Promise<{ layer: LayerSummary; revision: number }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers`, json('POST', { kind: 'free', ...input }));
}
export function addEditCopy(
  mapId: string,
  input: { layerKey: string; title?: string; expectedRevision: number }
): Promise<{ layer: LayerSummary; revision: number }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers`, json('POST', { kind: 'edit_copy', ...input }));
}
export function updateLayer(
  mapId: string,
  layerId: string,
  input: { title?: string; style?: Record<string, unknown>; position?: number; fields?: FieldEdit[]; expectedRevision: number }
): Promise<{ layer: LayerSummary; revision: number }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}`, json('PATCH', input));
}
export function removeLayer(mapId: string, layerId: string, expectedRevision: number): Promise<{ revision: number }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}`, json('DELETE', { expectedRevision }));
}

// --- Features -----------------------------------------------------------------------------

export function listFeatures(
  mapId: string,
  layerId: string,
  query: { bbox: [number, number, number, number]; limit?: number }
): Promise<FeatureCollectionResponse> {
  const qs = new URLSearchParams({ bbox: query.bbox.join(',') });
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}/features?${qs}`);
}
export function addFeature(
  mapId: string,
  layerId: string,
  input: { geometry: GeoJsonGeometry; properties?: Record<string, unknown>; expectedRevision: number }
): Promise<{ feature: PersonalFeature; revision: number; warnings?: FeatureWarning[] }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}/features`, json('POST', input));
}
export function updateFeature(
  mapId: string,
  layerId: string,
  featureId: string,
  input: { geometry?: GeoJsonGeometry; properties?: Record<string, unknown>; expectedRevision: number }
): Promise<{ feature: PersonalFeature; revision: number; warnings?: FeatureWarning[] }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}/features/${featureId}`, json('PUT', input));
}
export function removeFeature(
  mapId: string,
  layerId: string,
  featureId: string,
  expectedRevision: number
): Promise<{ revision: number }> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}/features/${featureId}`, json('DELETE', { expectedRevision }));
}

export function queryLayer(mapId: string, layerId: string, body: LayerQueryRequest): Promise<LayerQueryResponse> {
  return apiRequest(`${BASE}/maps/${mapId}/layers/${layerId}/query`, json('POST', body));
}

// --- Shares -------------------------------------------------------------------------------

export function listShares(mapId: string): Promise<Share[]> {
  return apiRequest<{ shares: Share[] }>(`${BASE}/maps/${mapId}/shares`).then((r) => r.shares);
}
export function addShare(mapId: string, target: { userId: string } | { groupId: string }): Promise<Share> {
  return apiRequest<{ share: Share }>(`${BASE}/maps/${mapId}/shares`, json('POST', target)).then((r) => r.share);
}
export function removeShare(mapId: string, shareId: string): Promise<void> {
  return apiRequest<void>(`${BASE}/maps/${mapId}/shares/${shareId}`, { method: 'DELETE' });
}
export function searchShareTargets(q: string): Promise<ShareTargets> {
  return apiRequest(`${BASE}/share-targets?${new URLSearchParams({ q })}`);
}

// --- Files and jobs -----------------------------------------------------------------------

export function listUploads(): Promise<{ uploads: Upload[]; usageBytes: number; quotaBytes: number }> {
  return apiRequest(`${BASE}/uploads`);
}
export function queueImport(mapId: string, input: { fileId: string; sourceCrs?: string | null }): Promise<{ job: Job }> {
  return apiRequest(`${BASE}/maps/${mapId}/imports`, json('POST', input));
}
export function queueExport(mapId: string, input: ExportRequest): Promise<{ job: Job; warnings: string[] }> {
  return apiRequest(`${BASE}/maps/${mapId}/exports`, json('POST', input));
}
export function previewExport(mapId: string, query: ExportRequest): Promise<ExportPreview> {
  const qs = new URLSearchParams({ format: query.format, crs: query.crs });
  if (query.layerIds?.length) qs.set('layerIds', query.layerIds.join(','));
  return apiRequest(`${BASE}/maps/${mapId}/exports/preview?${qs}`);
}
export function getJob(id: string): Promise<Job> {
  return apiRequest<{ job: Job }>(`${BASE}/jobs/${id}`).then((r) => r.job);
}
export function listJobs(query: { mapId?: string } = {}): Promise<Job[]> {
  const qs = query.mapId ? `?${new URLSearchParams({ mapId: query.mapId })}` : '';
  return apiRequest<{ jobs: Job[] }>(`${BASE}/jobs${qs}`).then((r) => r.jobs);
}
export function deleteJob(id: string): Promise<void> {
  return apiRequest<void>(`${BASE}/jobs/${id}`, { method: 'DELETE' });
}

// --- Admin --------------------------------------------------------------------------------

export function adminSummary(): Promise<OwnerSummary[]> {
  return apiRequest<{ owners: OwnerSummary[] }>(`${BASE}/admin/summary`).then((r) => r.owners);
}
