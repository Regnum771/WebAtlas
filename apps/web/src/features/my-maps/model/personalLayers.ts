import type Map from 'ol/Map';
import type Feature from 'ol/Feature';
import type { Extent } from 'ol/extent';
import GeoJSON from 'ol/format/GeoJSON';
import type Layer from 'ol/layer/Layer';
import VectorLayer from 'ol/layer/Vector';
import WebGLTileLayer, { type Style as TileStyle } from 'ol/layer/WebGLTile';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { transformExtent, type ProjectionLike } from 'ol/proj';
import GeoTIFF, { type SourceInfo } from 'ol/source/GeoTIFF';
import VectorSource from 'ol/source/Vector';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import { getAuthToken } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';
import { listFeatures, type GeoJsonGeometry, type LayerSummary, type PersonalFeature } from '../api/workspace.api';
import { isPersonalLayer, PERSONAL_HIT_TOLERANCE, PERSONAL_LAYER_PROP } from '../../map/model/overlayLayers';
import { editCopyStyle, olStyleFor, parseStyle } from './personalStyle';

/**
 * Personal-map layers on the OpenLayers map, owned here as flood-scenario/model/floodLayers.ts
 * owns its layers. Between the official layers (zIndex 0) and the flood scenario (990+) and the
 * ROI (997): personal layers take 800 + their order.
 */
export const PERSONAL_Z_BASE = 800;
/** Features per viewport read. The API caps it too; a cut read shows the truncation note. */
export const PERSONAL_READ_LIMIT = 5000;

export interface PersonalLayerEntry {
  mapId: string;
  layer: LayerSummary;
  visible: boolean;
  opacity: number;
  zIndex: number;
  /** `n`: the last read was cut at n features; `null`: it was complete (or the layer left the map). */
  onTruncated: (layerId: string, n: number | null) => void;
}

interface Drawn {
  layer: VectorLayer<VectorSource>;
  /** The latest entry: its callback and its map. */
  entry: PersonalLayerEntry;
  /** What the current style was built from, so a repeat sync does not rebuild it. */
  styleKey: string;
  /** Edit copies: external_ids the draft touched, from the last read. */
  changed: Set<string>;
  /**
   * Views whose read was cut short or failed. They stay marked as loaded until the view moves,
   * then are forgotten so the new view is read: dropping them at once would make every redraw
   * (and each read's own redraw) read again, without end.
   */
  stale: Extent[];
  /** Bumped by a refresh: a read started before it is dropped. */
  generation: number;
  removed: boolean;
}

/** A raster layer: the COG read by byte range, drawn with WebGL. */
interface DrawnRaster {
  layer: WebGLTileLayer;
  entry: PersonalLayerEntry;
}

interface Registry {
  drawn: globalThis.Map<string, Drawn>;
  rasters: globalThis.Map<string, DrawnRaster>;
  onMoveEnd: () => void;
}

const registries = new WeakMap<Map, Registry>();
const format = new GeoJSON();

const isVector = (layer: LayerSummary) => layer.kind === 'free' || layer.kind === 'edit_copy';

function editableKey(layer: LayerSummary): EditableLayerKey | null {
  const key = layer.layerKey;
  return layer.kind === 'edit_copy' && (EDITABLE_LAYER_KEYS as readonly string[]).includes(key ?? '')
    ? (key as EditableLayerKey)
    : null;
}

function styleKeyOf(layer: LayerSummary): string {
  const key = editableKey(layer);
  return key ? `copy:${key}` : `free:${JSON.stringify(parseStyle(layer.style))}`;
}

function applyStyle(rec: Drawn): void {
  const key = editableKey(rec.entry.layer);
  rec.layer.setStyle(key
    ? editCopyStyle(key, (externalId) => rec.changed.has(externalId))
    : olStyleFor(parseStyle(rec.entry.layer.style)));
}

/** The view extent as an EPSG:4326 bbox the API accepts: clamped to the globe, rounded to ~0.1 m. */
function bbox4326(extent: Extent, projection: ProjectionLike): [number, number, number, number] {
  const [w, s, e, n] = transformExtent(extent, projection, 'EPSG:4326');
  const fit = (v: number, limit: number) => Math.round(Math.min(limit, Math.max(-limit, v)) * 1e6) / 1e6;
  return [fit(w, 180), fit(s, 90), fit(e, 180), fit(n, 90)];
}

function create(entry: PersonalLayerEntry): Drawn {
  const source = new VectorSource({ strategy: bboxStrategy });
  const layer = new VectorLayer({
    source,
    properties: { id: `ws:${entry.layer.id}`, [PERSONAL_LAYER_PROP]: true, mapId: entry.mapId, layerId: entry.layer.id },
  });
  const rec: Drawn = { layer, entry, styleKey: '', changed: new Set(), stale: [], generation: 0, removed: false };
  source.setLoader((extent, _resolution, projection, success, failure) => {
    const generation = rec.generation;
    const { mapId, layer: { id } } = rec.entry;
    listFeatures(mapId, id, { bbox: bbox4326(extent, projection), limit: PERSONAL_READ_LIMIT })
      .then((res) => {
        if (rec.removed || generation !== rec.generation) {
          success?.([]);
          return;
        }
        const features = (format.readFeatures(res, { dataProjection: 'EPSG:4326', featureProjection: projection }) as Feature[])
          .filter((f) => f.getGeometry());
        // Features already read for an overlapping view keep their id and are not added twice.
        source.addFeatures(features);
        if (res.changed) {
          rec.changed = new Set(res.changed);
          layer.changed();
        }
        // A cut view is read again once the view moves (zooming in shows more).
        if (res.truncated) rec.stale.push(extent);
        rec.entry.onTruncated(id, res.truncated ? res.features.length : null);
        success?.(features);
      })
      .catch(() => {
        // Retried once the view moves, not on every redraw.
        if (!rec.removed && generation === rec.generation) rec.stale.push(extent);
        failure?.();
      });
  });
  return rec;
}

type Band = ['band', number];

/** How a raster layer's COG is read and drawn, from its metadata (import_raster.py). */
interface RasterPlan {
  source: Omit<SourceInfo, 'url'>;
  color: TileStyle['color'];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** nodata as stored: a number, or "NaN" / "Infinity" / "-Infinity", which jsonb cannot hold as numbers. */
function nodataOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value === 'NaN' || value === 'Infinity' || value === '-Infinity') return Number(value);
  return undefined;
}

/**
 * The bands of a raster layer's COG and how they are drawn:
 * - data bands are scaled to their `stats` range; without stats a uint8 image spans 0-255 and
 *   other types are left to the source (the file's statistics, else the type's range);
 * - one band (or two) is drawn grey, three or more as RGB from bands 1-3;
 * - an alpha band masks: the source's own (the band after the data bands), or the one the worker
 *   adds to an image with neither nodata nor alpha (band count + 1). Both are known only from
 *   `stats`, which lists the data bands; a raster imported before stats existed has no added band;
 * - nodata masks too: the GeoTIFF source then appends an alpha band of its own after the file's.
 */
function rasterPlan(layer: LayerSummary): RasterPlan {
  const meta = layer.raster ?? {};
  const bands = finite(meta.bands) && meta.bands >= 1 ? meta.bands : 1;
  const dtype = typeof meta.dtype === 'string' ? meta.dtype : null;
  const nodata = nodataOf(meta.nodata);
  const stats = Array.isArray(meta.stats) && meta.stats.length > 0
    ? (meta.stats as unknown[]).map((s) => {
      const { min, max } = (s ?? {}) as { min?: unknown; max?: unknown };
      // An empty or constant band has no range to scale to: the source's default applies.
      return finite(min) && finite(max) && max > min ? { min, max } : null;
    })
    : null;

  const dataBands = stats ? Math.min(stats.length, bands) : bands;
  let alphaBand: number | null = null;
  if (stats && bands > stats.length) alphaBand = bands;
  else if (stats && nodata === undefined) alphaBand = bands + 1;
  const fileBands = Math.max(bands, alphaBand ?? 0);

  const source: Omit<SourceInfo, 'url'> = {};
  if (stats) {
    const min: Array<number | undefined> = stats.map((s) => s?.min);
    const max: Array<number | undefined> = stats.map((s) => s?.max);
    if (alphaBand) {
      // 8-bit alpha keeps its levels; a wider one (GDAL writes 65535, 32767 or 255) counts as on/off.
      min[alphaBand - 1] = 0;
      max[alphaBand - 1] = dtype === 'uint8' ? 255 : 1;
    }
    source.min = min;
    source.max = max;
  } else if (dtype === 'uint8') {
    source.min = 0;
    source.max = 255;
  }
  if (nodata !== undefined) source.nodata = nodata;

  const band = (n: number): Band => ['band', n];
  const masks = [alphaBand, nodata !== undefined ? fileBands + 1 : null]
    .filter((n): n is number => n !== null)
    .map(band);
  const alpha = masks.length === 0 ? 1 : masks.length === 1 ? masks[0] : ['*', ...masks];
  const color = dataBands >= 3
    ? ['array', band(1), band(2), band(3), alpha]
    : ['array', band(1), band(1), band(1), alpha];
  return { source, color };
}

function createRaster(entry: PersonalLayerEntry): DrawnRaster {
  const { source, color } = rasterPlan(entry.layer);
  const token = getAuthToken();
  const url = `${API_BASE_URL}/api/workspace/maps/${entry.mapId}/layers/${entry.layer.id}/raster`;
  const layer = new WebGLTileLayer({
    source: new GeoTIFF({
      sources: [{ url, ...source }],
      ...(token ? { sourceOptions: { headers: { Authorization: `Bearer ${token}` } } } : {}),
      normalize: true,
    }),
    style: { color },
    properties: { id: `ws:${entry.layer.id}`, [PERSONAL_LAYER_PROP]: true, mapId: entry.mapId, layerId: entry.layer.id },
  });
  return { layer, entry };
}

/** After a move: forget the stale views, and redraw so the current view is read if it needs to be. */
function forgetStaleViews(drawn: globalThis.Map<string, Drawn>): void {
  for (const rec of drawn.values()) {
    if (rec.stale.length === 0) continue;
    const source = rec.layer.getSource()!;
    for (const extent of rec.stale) source.removeLoadedExtent(extent);
    rec.stale = [];
    source.changed();
  }
}

function remove(map: Map, drawn: globalThis.Map<string, Drawn>, layerId: string, rec: Drawn): void {
  rec.removed = true;
  map.removeLayer(rec.layer);
  drawn.delete(layerId);
  rec.entry.onTruncated(layerId, null);
}

/** The visible raster entries on the map, each kept across syncs; only opacity and order change. */
function syncRasters(map: Map, rasters: globalThis.Map<string, DrawnRaster>, entries: PersonalLayerEntry[]): void {
  const wanted = new globalThis.Map(
    entries.filter((e) => e.visible && e.layer.kind === 'raster').map((e) => [e.layer.id, e] as const),
  );
  for (const [layerId, rec] of [...rasters]) {
    if (wanted.get(layerId)?.mapId !== rec.entry.mapId) {
      map.removeLayer(rec.layer);
      rec.layer.dispose();
      rasters.delete(layerId);
    }
  }
  for (const [layerId, entry] of wanted) {
    let rec = rasters.get(layerId);
    if (!rec) {
      rec = createRaster(entry);
      map.addLayer(rec.layer);
      rasters.set(layerId, rec);
    }
    rec.entry = entry;
    if (rec.layer.getZIndex() !== entry.zIndex) rec.layer.setZIndex(entry.zIndex);
    if (rec.layer.getOpacity() !== entry.opacity) rec.layer.setOpacity(entry.opacity);
  }
}

/**
 * Puts the visible entries on the map (vector layers read by viewport, rasters as WebGL tiles) and
 * takes everything else off: a hidden layer, a collapsed map, a deleted layer. A repeat sync keeps
 * each layer (and its loaded features) and only updates style, opacity and order.
 */
export function syncPersonalLayers(map: Map, entries: PersonalLayerEntry[]): void {
  let registry = registries.get(map);
  if (!registry) {
    if (entries.length === 0) return;
    const created: Registry = {
      drawn: new globalThis.Map(), rasters: new globalThis.Map(), onMoveEnd: () => forgetStaleViews(created.drawn),
    };
    map.on('moveend', created.onMoveEnd);
    registries.set(map, created);
    registry = created;
  }
  const { drawn, rasters } = registry;
  syncRasters(map, rasters, entries);
  const wanted = new globalThis.Map(
    entries.filter((e) => e.visible && isVector(e.layer)).map((e) => [e.layer.id, e] as const),
  );
  for (const [layerId, rec] of [...drawn]) {
    const next = wanted.get(layerId);
    const same = next && next.mapId === rec.entry.mapId && next.layer.kind === rec.entry.layer.kind
      && next.layer.layerKey === rec.entry.layer.layerKey;
    if (!same) remove(map, drawn, layerId, rec);
  }
  for (const [layerId, entry] of wanted) {
    let rec = drawn.get(layerId);
    if (!rec) {
      rec = create(entry);
      map.addLayer(rec.layer);
      drawn.set(layerId, rec);
    }
    rec.entry = entry;
    const styleKey = styleKeyOf(entry.layer);
    if (styleKey !== rec.styleKey) {
      rec.styleKey = styleKey;
      applyStyle(rec);
    }
    if (rec.layer.getZIndex() !== entry.zIndex) rec.layer.setZIndex(entry.zIndex);
    if (rec.layer.getOpacity() !== entry.opacity) rec.layer.setOpacity(entry.opacity);
  }
  if (drawn.size === 0 && rasters.size === 0) {
    map.un('moveend', registry.onMoveEnd);
    registries.delete(map);
  }
}

/** Drops the layer's features and reads the current view again (after a write to the layer). */
export function refreshPersonalLayer(map: Map, layerId: string): void {
  const rec = registries.get(map)?.drawn.get(layerId);
  if (!rec) return;
  rec.generation++;
  rec.stale = [];
  rec.layer.getSource()!.refresh();
}

/** Zoom cap of a fit: a single point or a tiny layer stays at street level, not zoomed to the maximum. */
const FIT_MAX_ZOOM = 15;
const MERCATOR_MAX_LAT = 85.0511;

/** Flies the view to an EPSG:4326 extent [w, s, e, n] (after an import: the new layers' extent). */
export function fitToExtent4326(map: Map, extent: [number, number, number, number]): void {
  const view = map.getView();
  // Web Mercator has no poles: clamp the latitudes so the transformed extent stays finite.
  const lat = (v: number) => Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, v));
  const [w, s, e, n] = extent;
  const target = transformExtent([w, lat(s), e, lat(n)], 'EPSG:4326', view.getProjection());
  if (!target.every(Number.isFinite)) return;
  view.fit(target, { padding: [60, 60, 60, 60], maxZoom: FIT_MAX_ZOOM, duration: 400 });
}

/** The topmost personal feature under a pixel, as the API's GeoJSON (EPSG:4326), with its map and layer. */
export function personalFeatureAt(
  map: Map, pixel: number[],
): { mapId: string; layerId: string; feature: PersonalFeature } | null {
  const hit = map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => ({ feature: feature as Feature, layer: layer as Layer }),
    { layerFilter: (layer) => isPersonalLayer(layer), hitTolerance: PERSONAL_HIT_TOLERANCE },
  );
  if (!hit) return null;
  const geo = format.writeFeatureObject(hit.feature, {
    dataProjection: 'EPSG:4326',
    featureProjection: map.getView().getProjection(),
  });
  return {
    mapId: hit.layer.get('mapId') as string,
    layerId: hit.layer.get('layerId') as string,
    feature: {
      type: 'Feature',
      id: String(hit.feature.getId() ?? ''),
      geometry: (geo.geometry as GeoJsonGeometry | null) ?? null,
      properties: (geo.properties as Record<string, unknown> | null) ?? {},
    },
  };
}
