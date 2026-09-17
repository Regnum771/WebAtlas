import type { AnalysisResult, EditableLayerKey, ResultGeometry } from '@webatlas/shared';
import {
  LAYER_LABELS, POINT_SQL, candidateCtes, layerTable, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import type { NearestInput } from '../schemas';

// How many nearest-by-planar-distance candidates to pull off the base table
// per requested result, before resolving the version chain and re-ordering
// by true geography distance. KNN has no simple indexable predicate the way
// a bbox test does, so this is a bounded over-fetch rather than an exact
// filter — generous enough that in practice (one active ingest version per
// layer) the resolved set always has at least `limit` rows, but a layer with
// many edit-versions could starve the candidate set, hence the fallback
// below rather than trusting the over-fetch blindly.
const NEAREST_OVERFETCH_FACTOR = 20;

export interface NearestRow { featureId: string; name: string | null; lon: number; lat: number; distanceKm: number }

export async function queryNearest(
  db: Queryable,
  q: { layerKey: EditableLayerKey; lon: number; lat: number; limit: number }
): Promise<NearestRow[]> {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
  const overfetch = q.limit * NEAREST_OVERFETCH_FACTOR;
  const ctes = candidateCtes(
    q.layerKey,
    `SELECT external_id FROM ${layerTable(q.layerKey)} ORDER BY geom <-> ${point} LIMIT $4`
  );
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  const { rows: fastRows } = await db.query<NearestRow>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM resolved
      WHERE NOT deleted
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch]
  );
  if (fastRows.length >= q.limit) return fastRows;

  // The over-fetch came back short. That's a legitimate answer if the
  // layer genuinely has fewer than `limit` active features — but if it
  // has enough, the candidate step must have missed some (starved by
  // many edit-versions spreading the same external_ids across more
  // physical rows than the over-fetch pulled). Rather than silently
  // return a short answer, fall back to the exact query.
  const view = layerView(q.layerKey);
  const { rows: countRows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${view}`);
  if (Number(countRows[0].n) < q.limit) return fastRows;
  const { rows: exactRows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM ${view}
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit]
  );
  return exactRows;
}

/** Connector lines from the chosen point to each nearest feature. */
export function nearestGeometries(
  layerKey: EditableLayerKey, lon: number, lat: number, rows: NearestRow[]
): ResultGeometry[] {
  return [
    { geometry: { type: 'Point', coordinates: [lon, lat] }, role: 'input', label: 'Điểm chọn' },
    ...rows.flatMap((r): ResultGeometry[] => [
      { geometry: { type: 'LineString', coordinates: [[lon, lat], [r.lon, r.lat]] }, role: 'result', label: `${r.distanceKm} km` },
      {
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, role: 'highlight', layerKey, featureId: r.featureId,
        ...(r.name ? { label: r.name } : {}),
      },
    ]),
  ];
}

export async function nearestOp(db: Queryable, input: NearestInput): Promise<AnalysisResult> {
  const rows = await queryNearest(db, { layerKey: input.layerKey, lon: input.lon, lat: input.lat, limit: input.k });
  return {
    op: 'nearest',
    summary: {
      'Lớp': LAYER_LABELS[input.layerKey],
      'Số đối tượng': rows.length,
      'Gần nhất (km)': rows[0]?.distanceKm ?? '—',
    },
    rows: rows.map((r) => ({ layerKey: input.layerKey, ...r })),
    geometries: nearestGeometries(input.layerKey, input.lon, input.lat, rows),
  };
}
