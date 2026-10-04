import type { AnalysisResult, EditableLayerKey, ResultGeometry, Roi } from '@webatlas/shared';
import {
  LAYER_LABELS, POINT_SQL, entityPredicate, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import { resolveRoi } from '../../roi/resolve';
import type { NearestInput } from '../schemas';

// How many nearest-by-planar-distance candidates to take per requested result before
// re-ordering by geodesic distance. Planar and geodesic order differ only slightly at this
// latitude, so 20x is generous.
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
  // The entity predicate goes inside the KNN over-fetch too: without it, the
  // over-fetch for rivers is spent on reaches and ways, the nearest rows of all.
  const entity = entityPredicate(q.layerKey);
  const notExcluded = '($5::uuid IS NULL OR id <> $5::uuid)';
  const view = layerView(q.layerKey);
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  // The planar KNN (<->) reaches the view's partial spatial index; the over-fetch is then
  // re-ordered by true geodesic distance. The view holds one row per feature, so the over-fetch
  // returns min(layer size, overfetch) rows and cannot be starved by older versions' rows, which
  // is what the old exact-query fallback existed for.
  const { rows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM (SELECT id, name, geom FROM ${view}
              WHERE ${entity} AND ${notExcluded}
              ORDER BY geom <-> ${point}
              LIMIT $4) AS candidates
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch, q.excludeId ?? null]
  );
  return rows;
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
