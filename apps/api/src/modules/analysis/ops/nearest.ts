import type { AnalysisResult, EditableLayerKey, ResultGeometry, Roi } from '@webatlas/shared';
import {
  LAYER_LABELS, POINT_SQL, candidateCtes, entityPredicate, layerTable, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import { resolveRoi } from '../../roi/resolve';
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

/**
 * `excludeId` leaves one feature out — the ROI itself, so "3 đập gần đập X nhất" does
 * not answer with đập X at 0 km (spec §10).
 */
export async function queryNearest(
  db: Queryable,
  q: { layerKey: EditableLayerKey; lon: number; lat: number; limit: number; excludeId?: string }
): Promise<NearestRow[]> {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
  const overfetch = q.limit * NEAREST_OVERFETCH_FACTOR;
  // The entity predicate goes in the KNN candidate step too: without it, the
  // over-fetch for rivers is spent on reaches and ways, the nearest rows of all.
  const entity = entityPredicate(q.layerKey);
  const notExcluded = '($5::uuid IS NULL OR id <> $5::uuid)';
  const ctes = candidateCtes(
    q.layerKey,
    `SELECT external_id FROM ${layerTable(q.layerKey)}
      WHERE ${entity} AND ${notExcluded}
      ORDER BY geom <-> ${point} LIMIT $4`
  );
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  const { rows: fastRows } = await db.query<NearestRow>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM resolved
      WHERE NOT deleted AND ${entity} AND ${notExcluded}
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch, q.excludeId ?? null]
  );
  if (fastRows.length >= q.limit) return fastRows;

  // The over-fetch came back short. That's a legitimate answer if the
  // layer genuinely has fewer than `limit` active features — but if it
  // has enough, the candidate step must have missed some (starved by
  // many edit-versions spreading the same external_ids across more
  // physical rows than the over-fetch pulled). Rather than silently
  // return a short answer, fall back to the exact query.
  const view = layerView(q.layerKey);
  const { rows: countRows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${view} WHERE ${entity} AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [q.excludeId ?? null]
  );
  if (Number(countRows[0].n) < q.limit) return fastRows;
  const { rows: exactRows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM ${view}
      WHERE ${entity} AND ($4::uuid IS NULL OR id <> $4::uuid)
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, q.excludeId ?? null]
  );
  return exactRows;
}

/** Connector lines from the origin point to each nearest feature. */
export function nearestGeometries(
  layerKey: EditableLayerKey, lon: number, lat: number, rows: NearestRow[], originLabel = 'Điểm chọn'
): ResultGeometry[] {
  return [
    { geometry: { type: 'Point', coordinates: [lon, lat] }, role: 'input', label: originLabel },
    ...rows.flatMap((r): ResultGeometry[] => [
      { geometry: { type: 'LineString', coordinates: [[lon, lat], [r.lon, r.lat]] }, role: 'result', label: `${r.distanceKm} km` },
      {
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, role: 'highlight', layerKey, featureId: r.featureId,
        ...(r.name ? { label: r.name } : {}),
      },
    ]),
  ];
}

/**
 * Gần nhất measures from the ROI's centroid (D12), so it works for any kind; a point's
 * centroid is the point. The centroid is drawn and named, because for a curved river or
 * an L-shaped area it can fall outside the shape itself.
 */
export async function nearestOp(db: Queryable, input: NearestInput): Promise<AnalysisResult> {
  const { resolved, facts } = await resolveRoi(db, input.roi as Roi);
  const [lon, lat] = resolved.centroid;
  const excludeId = facts.feature?.layerKey === input.layerKey ? facts.feature.featureId : undefined;
  const rows = await queryNearest(db, {
    layerKey: input.layerKey, lon, lat, limit: input.k, ...(excludeId ? { excludeId } : {}),
  });
  const fromCentroid = resolved.kind !== 'point';
  return {
    op: 'nearest',
    summary: {
      'Lớp': LAYER_LABELS[input.layerKey],
      'Tính từ': fromCentroid ? `Trọng tâm của ${resolved.label}` : resolved.label,
      'Số đối tượng': rows.length,
      'Gần nhất (km)': rows[0]?.distanceKm ?? '—',
    },
    rows: rows.map((r) => ({ layerKey: input.layerKey, ...r })),
    geometries: nearestGeometries(input.layerKey, lon, lat, rows, fromCentroid ? 'Trọng tâm vùng phân tích' : resolved.label),
  };
}
