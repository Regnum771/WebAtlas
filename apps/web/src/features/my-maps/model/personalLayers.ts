import type Map from 'ol/Map';
import type Feature from 'ol/Feature';
import type { Extent } from 'ol/extent';
import GeoJSON from 'ol/format/GeoJSON';
import type Layer from 'ol/layer/Layer';
import VectorLayer from 'ol/layer/Vector';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { transformExtent, type ProjectionLike } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { isMapNotFound } from './queries';
import { listFeatures, type GeoJsonGeometry, type LayerSummary, type PersonalFeature } from '../api/workspace.api';
import { isPersonalLayer, PERSONAL_HIT_TOLERANCE, PERSONAL_LAYER_PROP } from '../../map/model/overlayLayers';
import { editCopyKey, editCopyStyle, olStyleFor, parseStyle } from './personalStyle';

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
  /** A read answered the map's own 404: the map was unshared or deleted. */
  onMapGone?: (mapId: string) => void;
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

/** A raster layer: the COG read by byte range, drawn with WebGL (rasterLayer.ts, loaded on demand). */
interface DrawnRaster {
  /** null until the raster code has loaded. */
  layer: Layer | null;
  entry: PersonalLayerEntry;
  /** Set when the entry leaves the map: a load finishing afterwards adds nothing. */
  removed: boolean;
}

interface Registry {
  drawn: globalThis.Map<string, Drawn>;
  rasters: globalThis.Map<string, DrawnRaster>;
  onMoveEnd: () => void;
}

const registries = new WeakMap<Map, Registry>();
const format = new GeoJSON();

const isVector = (layer: LayerSummary) => layer.kind === 'free' || layer.kind === 'edit_copy';
const editableKey = editCopyKey;

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
      .catch((e: unknown) => {
        // Retried once the view moves, not on every redraw.
        if (!rec.removed && generation === rec.generation) rec.stale.push(extent);
        if (!rec.removed && isMapNotFound(e)) rec.entry.onMapGone?.(mapId);
        failure?.();
      });
  });
  return rec;
}

/** The raster code (geotiff and the WebGL renderer), imported once, the first time a raster is shown. */
let rasterCode: Promise<typeof import('./rasterLayer')> | null = null;
const loadRasterCode = () => (rasterCode ??= import('./rasterLayer'));

/** Puts the raster on the map once its code has loaded, unless the entry has left the map meanwhile. */
function addRasterWhenLoaded(map: Map, rasters: globalThis.Map<string, DrawnRaster>, rec: DrawnRaster): void {
  loadRasterCode().then(({ createRasterLayer }) => {
    if (rec.removed) return;
    const { mapId, layer, zIndex, opacity } = rec.entry;
    rec.layer = createRasterLayer(mapId, layer);
    rec.layer.setZIndex(zIndex);
    rec.layer.setOpacity(opacity);
    map.addLayer(rec.layer);
  }).catch(() => {
    // The chunk did not load (offline, a new deploy): forget the entry so a later sync tries again.
    rasterCode = null;
    if (!rec.removed && rasters.get(rec.entry.layer.id) === rec) rasters.delete(rec.entry.layer.id);
  });
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

/**
 * The visible raster entries on the map, each kept across syncs; only opacity and order change.
 * A new raster is added once the raster code has loaded; vector layers do not wait for it.
 */
function syncRasters(map: Map, rasters: globalThis.Map<string, DrawnRaster>, entries: PersonalLayerEntry[]): void {
  const wanted = new globalThis.Map(
    entries.filter((e) => e.visible && e.layer.kind === 'raster').map((e) => [e.layer.id, e] as const),
  );
  for (const [layerId, rec] of [...rasters]) {
    if (wanted.get(layerId)?.mapId !== rec.entry.mapId) {
      rec.removed = true;
      if (rec.layer) {
        map.removeLayer(rec.layer);
        rec.layer.dispose();
      }
      rasters.delete(layerId);
    }
  }
  for (const [layerId, entry] of wanted) {
    let rec = rasters.get(layerId);
    if (!rec) {
      rec = { layer: null, entry, removed: false };
      rasters.set(layerId, rec);
      addRasterWhenLoaded(map, rasters, rec);
    }
    // A raster still loading takes the latest order and opacity when it is added.
    rec.entry = entry;
    if (!rec.layer) continue;
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

/** The map's view as an EPSG:4326 bbox [w, s, e, n], or null before the map has a size. */
export function viewExtent4326(map: Map): [number, number, number, number] | null {
  const size = map.getSize();
  if (!size || size[0] === 0 || size[1] === 0) return null;
  const view = map.getView();
  return bbox4326(view.calculateExtent(size), view.getProjection());
}

/**
 * Calls `onChange` with the view's EPSG:4326 bbox after each pan, zoom or resize has ended (never
 * during the movement). Returns the unsubscribe.
 */
export function watchViewExtent4326(map: Map, onChange: (extent: [number, number, number, number]) => void): () => void {
  const listener = () => {
    const extent = viewExtent4326(map);
    if (extent) onChange(extent);
  };
  map.on('moveend', listener);
  return () => map.un('moveend', listener);
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

/**
 * The topmost personal feature under a pixel, as the API's GeoJSON (EPSG:4326), with its map and
 * layer. With `mapId`, only that map's layers are hit (a feature-edit mode on one map).
 */
export function personalFeatureAt(
  map: Map, pixel: number[], mapId?: string,
): { mapId: string; layerId: string; feature: PersonalFeature } | null {
  const hit = map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => ({ feature: feature as Feature, layer: layer as Layer }),
    {
      layerFilter: (layer) => isPersonalLayer(layer) && (mapId === undefined || layer.get('mapId') === mapId),
      hitTolerance: PERSONAL_HIT_TOLERANCE,
    },
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
