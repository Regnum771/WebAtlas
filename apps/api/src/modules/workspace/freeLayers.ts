import type { Pool, PoolClient } from 'pg';
import { NotFoundError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { assertValidGeoJsonInPg, geoJsonToGeomSql } from '../layers/geometry';
import { assertCanRead, bumpMap, lockMapForWrite, type Queryable } from './access';
import type { LayerSummary } from './maps';

export const LAYER_NOT_FOUND = 'Không tìm thấy lớp.';
export const FEATURE_NOT_FOUND = 'Không tìm thấy đối tượng.';
export const STYLE_TOO_LARGE = 'Kiểu hiển thị quá lớn.';
const STYLE_MAX_BYTES = 8 * 1024;
export const DEFAULT_LIMIT = 5000;
export const MAX_LIMIT = 20000;

type GeometryType = 'point' | 'line' | 'polygon';
type FieldType = 'text' | 'number' | 'date';
export interface FieldDef { name: string; type: FieldType }
export type GeoJsonGeometry = { type: string; coordinates: unknown[] } & Record<string, unknown>;

const ALLOWED_GEOMETRIES: Record<GeometryType, string[]> = {
  point: ['Point', 'MultiPoint'],
  line: ['LineString', 'MultiLineString'],
  polygon: ['Polygon', 'MultiPolygon'],
};
const GEOMETRY_WORD: Record<GeometryType, string> = { point: 'điểm', line: 'đường', polygon: 'vùng' };
const TYPE_WORD: Record<FieldType, string> = { text: 'chữ', number: 'số', date: 'ngày' };

interface FreeLayerRow { id: string; geometryType: GeometryType | null; fields: FieldDef[] }

const LAYER_COLUMNS = `l.id, l.kind, l.title, l.position, l.style, l.geometry_type AS "geometryType", l.fields,
  l.layer_key AS "layerKey", l.draft_id AS "draftId",
  CASE WHEN l.kind = 'free'
       THEN (SELECT count(*)::int FROM workspace.features f WHERE f.layer_id = l.id)
  END AS "featureCount",
  CASE WHEN l.kind = 'raster' THEN l.raster END AS raster`;

/** A free layer of this map; 404 when the id is not in this map or is not a free layer. */
async function loadFreeLayer(q: Queryable, mapId: string, layerId: string): Promise<FreeLayerRow> {
  const { rows } = await q.query<FreeLayerRow>(
    `SELECT id, geometry_type AS "geometryType", fields
       FROM workspace.map_layers WHERE id = $1 AND map_id = $2 AND kind = 'free'`,
    [layerId, mapId]
  );
  if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
  return rows[0];
}

/** The position after the map's last layer, for an INSERT whose `$1` is the map id. */
export const NEXT_POSITION = `(SELECT COALESCE(max(position), -1) + 1 FROM workspace.map_layers WHERE map_id = $1)`;

export async function loadSummary(q: Queryable, layerId: string): Promise<LayerSummary> {
  const { rows } = await q.query<LayerSummary>(
    `SELECT ${LAYER_COLUMNS} FROM workspace.map_layers l WHERE l.id = $1`, [layerId]
  );
  return rows[0];
}

export function checkStyle(style: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(style), 'utf8') > STYLE_MAX_BYTES) {
    throw new ValidationError(STYLE_TOO_LARGE, { field: 'style' });
  }
}

function checkGeometryType(layer: FreeLayerRow, geometry: GeoJsonGeometry): void {
  if (!layer.geometryType) return; // uploaded layers (P3b) take any geometry
  if (!ALLOWED_GEOMETRIES[layer.geometryType].includes(geometry.type)) {
    throw new ValidationError(`Lớp này chỉ nhận đối tượng dạng ${GEOMETRY_WORD[layer.geometryType]}.`, { field: 'geometry' });
  }
}

function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function checkProperties(layer: FreeLayerRow, properties: Record<string, unknown>): void {
  if (layer.fields.length === 0) return; // no declared fields: any properties
  const byName = new Map(layer.fields.map((f) => [f.name, f]));
  for (const [key, value] of Object.entries(properties)) {
    const def = byName.get(key);
    if (!def) throw new ValidationError(`Trường "${key}" không có trong lớp.`, { field: key });
    if (value === null) continue;
    const ok =
      def.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : def.type === 'date' ? typeof value === 'string' && isRealDate(value)
      : typeof value === 'string';
    if (!ok) throw new ValidationError(`Trường "${key}" phải là ${TYPE_WORD[def.type]}.`, { field: key });
  }
}

/**
 * Type-check, then PostGIS-validate (422 on invalid or empty), returning the JSON text to insert.
 * The writes insert it through geoJsonToGeomSql, which drops a third coordinate.
 */
async function checkGeometry(client: PoolClient, layer: FreeLayerRow, geometry: GeoJsonGeometry): Promise<string> {
  checkGeometryType(layer, geometry);
  const json = JSON.stringify(geometry);
  await assertValidGeoJsonInPg(client, json);
  return json;
}

const FEATURE_SELECT = `f.id::text AS id, ST_AsGeoJSON(f.geom)::jsonb AS geometry, f.properties`;
function toFeature(r: { id: string; geometry: unknown; properties: unknown }) {
  return { type: 'Feature' as const, id: r.id, geometry: r.geometry, properties: r.properties };
}

export function freeLayersService(pg: Pool) {
  return {
    async addLayer(
      user: CurrentUser, mapId: string,
      input: { title: string; geometryType: GeometryType; fields: FieldDef[]; style?: Record<string, unknown>; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      const style = input.style ?? {};
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        checkStyle(style);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO workspace.map_layers (map_id, kind, title, position, style, geometry_type, fields)
           VALUES ($1, 'free', $2, ${NEXT_POSITION}, $3::jsonb, $4, $5::jsonb)
           RETURNING id`,
          [mapId, input.title, JSON.stringify(style), input.geometryType, JSON.stringify(input.fields)]
        );
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, rows[0].id), revision };
      });
    },

    async updateLayer(
      user: CurrentUser, mapId: string, layerId: string,
      input: { title?: string; style?: Record<string, unknown>; position?: number; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await loadFreeLayer(client, mapId, layerId);
        await patchLayerRow(client, mapId, layerId, input);
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, layerId), revision };
      });
    },

    async removeLayer(
      user: CurrentUser, mapId: string, layerId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await loadFreeLayer(client, mapId, layerId);
        await deleteLayerRow(client, mapId, layerId);
        return { revision: await bumpMap(client, mapId) };
      });
    },

    async features(
      user: CurrentUser, mapId: string, layerId: string,
      opts: { bbox?: [number, number, number, number]; limit?: number } = {}
    ) {
      await assertCanRead(pg, mapId, user);
      await loadFreeLayer(pg, mapId, layerId);
      const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const params: unknown[] = [layerId];
      let where = 'f.layer_id = $1';
      if (opts.bbox) {
        params.push(...opts.bbox);
        where += ' AND f.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)';
      }
      params.push(limit + 1);
      const { rows } = await pg.query(
        `SELECT ${FEATURE_SELECT} FROM workspace.features f
          WHERE ${where} ORDER BY f.id LIMIT $${params.length}`,
        params
      );
      const truncated = rows.length > limit;
      return { type: 'FeatureCollection' as const, features: rows.slice(0, limit).map(toFeature), truncated };
    },

    async addFeature(
      user: CurrentUser, mapId: string, layerId: string,
      input: { geometry: GeoJsonGeometry; properties: Record<string, unknown>; expectedRevision: number }
    ) {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        const layer = await loadFreeLayer(client, mapId, layerId);
        checkProperties(layer, input.properties);
        const geomJson = await checkGeometry(client, layer, input.geometry);
        const { rows } = await client.query(
          `INSERT INTO workspace.features AS f (layer_id, geom, properties)
           VALUES ($1, ${geoJsonToGeomSql(2)}, $3::jsonb)
           RETURNING ${FEATURE_SELECT}`,
          [layerId, geomJson, JSON.stringify(input.properties)]
        );
        return { feature: toFeature(rows[0]), revision: await bumpMap(client, mapId) };
      });
    },

    async updateFeature(
      user: CurrentUser, mapId: string, layerId: string, featureId: string,
      input: { geometry?: GeoJsonGeometry; properties?: Record<string, unknown>; expectedRevision: number }
    ) {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        const layer = await loadFreeLayer(client, mapId, layerId);
        if (input.properties) checkProperties(layer, input.properties);
        const geomJson = input.geometry ? await checkGeometry(client, layer, input.geometry) : null;
        const { rows } = await client.query(
          `UPDATE workspace.features f
              SET geom = COALESCE(${geoJsonToGeomSql(3, '::text')}, f.geom),
                  properties = COALESCE($4::jsonb, f.properties)
            WHERE f.id = $1 AND f.layer_id = $2
            RETURNING ${FEATURE_SELECT}`,
          [featureId, layerId, geomJson, input.properties ? JSON.stringify(input.properties) : null]
        );
        if (!rows[0]) throw new NotFoundError(FEATURE_NOT_FOUND);
        return { feature: toFeature(rows[0]), revision: await bumpMap(client, mapId) };
      });
    },

    async removeFeature(
      user: CurrentUser, mapId: string, layerId: string, featureId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await loadFreeLayer(client, mapId, layerId);
        const { rowCount } = await client.query(
          `DELETE FROM workspace.features WHERE id = $1 AND layer_id = $2`, [featureId, layerId]
        );
        if (!rowCount) throw new NotFoundError(FEATURE_NOT_FOUND);
        return { revision: await bumpMap(client, mapId) };
      });
    },
  };
}

// --- Layer-row operations shared by every layer kind (edit copies use them too) -----------
// They run on the caller's client, after lockMapForWrite and after the caller has checked that
// the layer belongs to the map; they neither check access nor bump the map.

/** Apply a PATCH of the layer's title, style and/or position. */
export async function patchLayerRow(
  client: PoolClient, mapId: string, layerId: string,
  input: { title?: string; style?: Record<string, unknown>; position?: number }
): Promise<void> {
  if (input.style !== undefined) checkStyle(input.style);
  await client.query(
    `UPDATE workspace.map_layers
        SET title = COALESCE($2, title), style = COALESCE($3::jsonb, style)
      WHERE id = $1`,
    [layerId, input.title ?? null, input.style === undefined ? null : JSON.stringify(input.style)]
  );
  if (input.position !== undefined) await moveLayer(client, mapId, layerId, input.position);
}

/** Delete the layer row (its features cascade) and close the gap it leaves in the order. */
export async function deleteLayerRow(client: PoolClient, mapId: string, layerId: string): Promise<void> {
  const { rows } = await client.query<{ position: number }>(
    `DELETE FROM workspace.map_layers WHERE id = $1 RETURNING position`, [layerId]
  );
  // Close the gap; the unique (map_id, position) is deferred, so one UPDATE is safe.
  await client.query(
    `UPDATE workspace.map_layers SET position = position - 1 WHERE map_id = $1 AND position > $2`,
    [mapId, rows[0].position]
  );
}

/** Move a layer to `target`, shifting the layers in between by one. Relies on the deferred unique. */
async function moveLayer(client: PoolClient, mapId: string, layerId: string, target: number): Promise<void> {
  const { rows } = await client.query<{ position: number; max: number }>(
    `SELECT l.position, (SELECT max(position) FROM workspace.map_layers WHERE map_id = $1) AS max
       FROM workspace.map_layers l WHERE l.id = $2`,
    [mapId, layerId]
  );
  const from = rows[0].position;
  const to = Math.min(target, rows[0].max);
  if (to === from) return;
  if (to > from) {
    await client.query(
      `UPDATE workspace.map_layers SET position = position - 1
        WHERE map_id = $1 AND position > $2 AND position <= $3`, [mapId, from, to]);
  } else {
    await client.query(
      `UPDATE workspace.map_layers SET position = position + 1
        WHERE map_id = $1 AND position >= $3 AND position < $2`, [mapId, from, to]);
  }
  await client.query(`UPDATE workspace.map_layers SET position = $2 WHERE id = $1`, [layerId, to]);
}

export type FreeLayersService = ReturnType<typeof freeLayersService>;
