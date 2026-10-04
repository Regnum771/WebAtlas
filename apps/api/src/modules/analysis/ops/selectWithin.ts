import {
  MAX_RESULT_ITEMS,
  capResultItems,
  type AnalysisResult,
  type AnalysisRow,
  type GeoJsonGeometry,
  type ResultGeometry,
  type Roi,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import {
  LAYER_LABELS, POINT_SQL, ROW_LIMIT, entityPredicate, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import { requireArea } from '../../roi/kind';
import { resolveRoi } from '../../roi/resolve';
import type { SelectWithinInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * Features of each layer inside the ROI. The predicate reaches the view's partial
 * indexes directly (S1). `count(*) OVER ()` is computed before LIMIT, so
 * counts are full even when drawing is capped.
 */
export async function selectWithinOp(db: Queryable, input: SelectWithinInput): Promise<AnalysisResult> {
  const { resolved, geojson, facts } = await resolveRoi(db, input.roi as Roi);
  requireArea(resolved, 'Chọn trong vùng');

  // An admin unit is counted by the codes stamped on every feature (D11, FR-17): the
  // same method as the assistant's features_in_admin_unit, so the two answers agree
  // (NFR-7), and served by the GIN index — the geometric path over Lâm Đồng took 5.2 s
  // cold. The column name comes from the resolver's facts, never from request input.
  const inArea = facts.admin
    ? {
        sql: `${facts.admin.level === 'province' ? 'province_codes' : 'ward_codes'} && ARRAY[$1]::text[]`,
        param: facts.admin.code,
        method: 'Theo mã hành chính đã gán' as const,
      }
    : { sql: `geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`, param: geojson as string, method: null };

  const summary: Record<string, number | string> = { 'Tổng số': 0 };
  const rows: AnalysisRow[] = [];
  const highlights: ResultGeometry[] = [];
  let total = 0;

  for (const key of input.layerKeys) {
    const entity = entityPredicate(key);
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM ${layerView(key)}
        WHERE geom IS NOT NULL AND ${inArea.sql} AND ${entity}
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [inArea.param, MAX_RESULT_ITEMS]
    );
    const n = found.length > 0 ? Number(found[0].total) : 0;
    summary[LAYER_LABELS[key]] = n;
    total += n;
    for (const f of found) {
      highlights.push({
        geometry: f.geometry, role: 'highlight', layerKey: key, featureId: f.featureId,
        ...(f.name ? { label: f.name } : {}),
      });
      if (rows.length < ROW_LIMIT) {
        rows.push({ layerKey: key, featureId: f.featureId, name: f.name, lon: f.lon, lat: f.lat });
      }
    }
  }

  summary['Tổng số'] = total;
  summary['Diện tích vùng (km²)'] = (resolved.measure as { areaKm2: number }).areaKm2;
  if (inArea.method) summary['Cách đếm'] = inArea.method;
  const capped = capResultItems([
    { geometry: resolved.display, role: 'input', label: resolved.label },
    ...highlights,
  ]);
  return {
    op: 'select_within',
    summary,
    rows,
    geometries: capped.items,
    truncated: capped.truncated || highlights.length < total,
  };
}
