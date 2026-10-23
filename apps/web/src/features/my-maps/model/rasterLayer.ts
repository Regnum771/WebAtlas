import WebGLTileLayer, { type Style as TileStyle } from 'ol/layer/WebGLTile';
import GeoTIFF, { type SourceInfo } from 'ol/source/GeoTIFF';
import { getAuthToken } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';
import type { LayerSummary } from '../api/workspace.api';
import { PERSONAL_LAYER_PROP } from '../../map/model/overlayLayers';

/**
 * The raster part of the personal layers (personalLayers.ts). It pulls in geotiff and the WebGL
 * tile renderer, so personalLayers.ts loads it with import() the first time a raster is shown,
 * keeping both out of the first page load.
 */

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

/** A raster layer of a personal map: its COG read by byte range with the session's token, drawn with WebGL. */
export function createRasterLayer(mapId: string, layer: LayerSummary): WebGLTileLayer {
  const { source, color } = rasterPlan(layer);
  const token = getAuthToken();
  const url = `${API_BASE_URL}/api/workspace/maps/${mapId}/layers/${layer.id}/raster`;
  return new WebGLTileLayer({
    source: new GeoTIFF({
      sources: [{ url, ...source }],
      ...(token ? { sourceOptions: { headers: { Authorization: `Bearer ${token}` } } } : {}),
      normalize: true,
    }),
    style: { color },
    properties: { id: `ws:${layer.id}`, [PERSONAL_LAYER_PROP]: true, mapId, layerId: layer.id },
  });
}
