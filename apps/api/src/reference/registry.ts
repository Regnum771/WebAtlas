import { NotFoundError } from '../errors';
// Defined in @webatlas/shared since Phase 4, so the browser's Roi type and this
// registry cannot drift apart; re-exported so existing imports keep working.
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '@webatlas/shared';

/**
 * The `basemap` reference layers, per spec §4.
 *
 * These are NOT the editable water layers. They are unversioned, have no
 * `external_id` and no `deleted` column, name their geometry column `geometry`
 * rather than `geom`, and are created by `apps/api/scripts/basemap/load_basemap.py`
 * rather than by a migration. They get their own read-only path, and this file is
 * the only place a reference layer key becomes SQL — the same rule `layerTable()`
 * follows for water.
 *
 * Out of scope on purpose: `dem_region` and `contours` (raster/derived, already
 * served by the elevation ops), and the `*_vn` national duplicates `roads_vn` /
 * `places_vn`, which would confuse a region-scoped atlas. `railways_vn` IS in
 * scope despite the `_vn` suffix because the loader builds no region variant of it.
 */
export { REFERENCE_LAYER_KEYS };
export type { ReferenceLayerKey };

/** Decides whether an ROI built from this layer needs a radius to become an area. */
export type ReferenceGeomKind = 'line' | 'point' | 'area';

export interface ReferenceLayerDef {
  key: ReferenceLayerKey;
  /** Schema-qualified; always `basemap.*`. */
  table: string;
  /** basemap tables name it `geometry`; water names it `geom`. */
  geomColumn: 'geometry';
  idColumn: 'osm_id';
  nameColumn: 'name';
  /** Only roads carry OSM `ref` (route numbers such as QL14). */
  refColumn?: 'ref';
  /** Classification column every loader table has; SLD rules filter on it. */
  classColumn: 'fclass';
  /** Numeric columns an aggregate may sum over the members of an entity. */
  summable: string[];
  geomKind: ReferenceGeomKind;
}

function def(
  key: ReferenceLayerKey,
  table: string,
  geomKind: ReferenceGeomKind,
  extra: { refColumn?: 'ref'; summable?: string[] } = {}
): ReferenceLayerDef {
  return {
    key,
    table,
    geomColumn: 'geometry',
    idColumn: 'osm_id',
    nameColumn: 'name',
    classColumn: 'fclass',
    summable: extra.summable ?? [],
    geomKind,
    ...(extra.refColumn ? { refColumn: extra.refColumn } : {}),
  };
}

export const REFERENCE_REGISTRY: Record<ReferenceLayerKey, ReferenceLayerDef> = {
  roads: def('roads', 'basemap.roads_region', 'line', { refColumn: 'ref' }),
  railways: def('railways', 'basemap.railways_vn', 'line'),
  water: def('water', 'basemap.water_region', 'area'),
  landuse: def('landuse', 'basemap.landuse_region', 'area'),
  places: def('places', 'basemap.places_region', 'point', { summable: ['population'] }),
};

export function getReferenceLayer(key: string): ReferenceLayerDef {
  const found = (REFERENCE_REGISTRY as Record<string, ReferenceLayerDef | undefined>)[key];
  if (!found) throw new NotFoundError('Không có lớp tham chiếu này');
  return found;
}

export function listReferenceMetadata(): Array<{
  key: ReferenceLayerKey;
  geomKind: ReferenceGeomKind;
  classColumn: string;
  summable: string[];
}> {
  return REFERENCE_LAYER_KEYS.map((key) => {
    const d = REFERENCE_REGISTRY[key];
    return { key, geomKind: d.geomKind, classColumn: d.classColumn, summable: d.summable };
  });
}
