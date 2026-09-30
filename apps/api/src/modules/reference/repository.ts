import type { Pool } from 'pg';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { getReferenceLayer, type ReferenceLayerKey } from '../../reference/registry';

export interface ReferenceEntity {
  entityId: string;
  layerKey: ReferenceLayerKey;
  name: string | null;
  ref: string | null;
  fclass: string | null;
  memberCount: number;
  attrs: Record<string, number>;
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
}

export interface ReferenceEntityWithGeometry extends ReferenceEntity {
  geometry: GeoJsonGeometry;
}

const BBOX_SQL = `ST_XMin(ST_Envelope(geom)) AS west, ST_YMin(ST_Envelope(geom)) AS south,
                  ST_XMax(ST_Envelope(geom)) AS east, ST_YMax(ST_Envelope(geom)) AS north`;

const BASE_COLUMNS = `entity_id AS "entityId", layer_key AS "layerKey", name, ref, fclass,
                      member_count AS "memberCount", attrs, ${BBOX_SQL}`;

interface Row {
  entityId: string;
  layerKey: ReferenceLayerKey;
  name: string | null;
  ref: string | null;
  fclass: string | null;
  memberCount: number;
  attrs: Record<string, number>;
  west: number; south: number; east: number; north: number;
  geometry?: GeoJsonGeometry;
}

function toEntity(r: Row): ReferenceEntity {
  return {
    entityId: r.entityId,
    layerKey: r.layerKey,
    name: r.name,
    ref: r.ref,
    fclass: r.fclass,
    memberCount: Number(r.memberCount),
    attrs: r.attrs ?? {},
    bbox: [r.west, r.south, r.east, r.north],
  };
}

export interface ListOptions {
  q?: string;
  fclass?: string;
  limit: number;
}

/** Entities of one layer, optionally trigram-filtered. No geometry — the list stays light. */
export async function listEntities(
  pool: Pool,
  key: ReferenceLayerKey,
  { q, fclass, limit }: ListOptions
): Promise<ReferenceEntity[]> {
  // Validates the key and keeps the registry the only path from key to SQL, even
  // though this table is keyed by layer_key rather than named per layer.
  getReferenceLayer(key);

  const where: string[] = ['layer_key = $1'];
  const params: unknown[] = [key];

  if (q) {
    params.push(q);
    // Both trigram indexes are usable here; ref carries QL14-style route numbers.
    where.push(`(name % $${params.length} OR ref % $${params.length})`);
  }
  if (fclass) {
    params.push(fclass);
    where.push(`fclass = $${params.length}`);
  }
  params.push(limit);

  const order = q
    ? `GREATEST(coalesce(similarity(name, $2), 0), coalesce(similarity(ref, $2), 0)) DESC, name ASC`
    : `member_count DESC, name ASC`;

  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS} FROM basemap.reference_entities
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params
  );
  return rows.map(toEntity);
}

/**
 * Every entity of one layer containing this OSM segment. `@>` on the text[] column is
 * what the GIN index from migration 21 serves. Usually one; two where a segment carries
 * two routes (e.g. `QL.14;HCM`, see referenceEntities.ts).
 */
export async function listEntitiesByMember(
  pool: Pool,
  key: ReferenceLayerKey,
  osmId: string
): Promise<ReferenceEntity[]> {
  getReferenceLayer(key);
  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS} FROM basemap.reference_entities
      WHERE layer_key = $1 AND member_ids @> ARRAY[$2]::text[]
      ORDER BY member_count DESC, entity_id`,
    [key, osmId]
  );
  return rows.map(toEntity);
}

/** One entity with a display-simplified geometry, or null. */
export async function getEntity(
  pool: Pool,
  key: ReferenceLayerKey,
  entityId: string
): Promise<ReferenceEntityWithGeometry | null> {
  getReferenceLayer(key);
  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS}, ${simplifiedGeoJsonSql('geom')} AS geometry
       FROM basemap.reference_entities
      WHERE layer_key = $1 AND entity_id = $2`,
    [key, entityId]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toEntity(row), geometry: row.geometry as GeoJsonGeometry };
}
